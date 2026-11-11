import type { Request, Response } from "express";
import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import SocialProfile, { LEGAL_CAPACITY, MARITAL_STATUS, PAYERS, PENSION_TYPES, PLACEMENT_BASIS, SEX } from "../models/SocialProfile.js";
import SocialDocument, { DOC_SECTIONS, DOC_TYPES, type DocType } from "../models/SocialDocument.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { addDays, normalizeStoredDay, parseCalendarDay } from "../utils/dateUtils.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { isValidJmbg, jmbgInfo } from "../services/social/jmbg.js";
import { buildMergeData, MERGE_FIELDS, MERGE_LISTS } from "../services/social/mergeFields.js";

export { isValidJmbg };

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends readonly string[]>(v: unknown, list: T, label: string): T[number] => {
  const s = typeof v === "string" ? v : "";
  if (!list.includes(s)) throw httpError(400, `${label}: nepoznata vrednost.`);
  return s as T[number];
};
const day = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === "") return null;
  const d = parseCalendarDay(v);
  if (!d) throw httpError(400, `${label}: neispravan datum.`);
  return d;
};
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

const audit = (req: Request, action: string, patient: unknown, fields: string[] = [], summary = "") =>
  AuditLog.create({ action, patient, user: req.user._id, fields, summary }).catch(() => undefined);

async function patientOr404(id: unknown) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Neispravan korisnik.");
  const patient = await Patient.findById(id);
  if (!patient) throw httpError(404, "Korisnik nije pronađen.");
  return patient;
}

// ── Profil ──────────────────────────────────────────────────────────────
// Čuva se samo ono što je poslato (delimičan unos je u redu — ostalo se dopunjuje kasnije).

type Parser = (v: unknown) => unknown;
const text = (max: number): Parser => (v) => str(v, max);
const PROFILE_FIELDS: Record<string, Parser> = {
  jmbg: (v) => {
    const jmbg = str(v, 20).replace(/\s/g, "");
    if (jmbg && !isValidJmbg(jmbg)) throw httpError(400, "JMBG nije ispravan (13 cifara, proverite kontrolnu cifru).");
    return jmbg;
  },
  parentName: text(120),
  birthPlace: text(120),
  sex: (v) => oneOf(v ?? "", SEX, "Pol"),
  citizenship: text(60),
  nationality: text(60),
  language: text(60),
  religion: text(60),
  maritalStatus: (v) => oneOf(v ?? "", MARITAL_STATUS, "Bračni status"),
  education: text(120),
  occupation: text(120),
  idCardNumber: text(30),
  healthInsuranceNumber: text(30),
  chosenDoctor: text(120),
  municipality: text(120),
  dossierNumber: text(40),
  accommodation: text(120),
  pensionType: (v) => oneOf(v ?? "", PENSION_TYPES, "Vrsta penzije"),
  incomeNote: text(300),
  payer: (v) => oneOf(v ?? "", PAYERS, "Ko plaća smeštaj"),
  legalCapacity: (v) => oneOf(v ?? "", LEGAL_CAPACITY, "Poslovna sposobnost"),
  guardian: (v) => {
    const g = obj(v);
    return {
      name: str(g.name, 120),
      relation: str(g.relation, 60),
      phone: str(g.phone, 60),
      decisionNumber: str(g.decisionNumber, 60),
      decisionDate: day(g.decisionDate, "Datum rešenja o starateljstvu"),
      authority: str(g.authority, 160),
    };
  },
  trustedPerson: (v) => {
    const t = obj(v);
    return { name: str(t.name, 120), relation: str(t.relation, 60), phone: str(t.phone, 60) };
  },
  placementBasis: (v) => oneOf(v ?? "", PLACEMENT_BASIS, "Osnov smeštaja"),
  contractNumber: text(60),
  contractDate: (v) => day(v, "Datum ugovora"),
  csrName: text(160),
  caseManager: text(120),
  csrDecisionNumber: text(60),
  csrDecisionDate: (v) => day(v, "Datum rešenja CSR-a"),
  contacts: (v) =>
    (Array.isArray(v) ? v.slice(0, 20) : [])
      .map(obj)
      .filter((c) => str(c.name, 120))
      .map((c) => ({
        name: str(c.name, 120),
        relation: str(c.relation, 60),
        phone: str(c.phone, 60),
        email: str(c.email, 120),
        address: str(c.address, 200),
        emergency: c.emergency === true,
        note: str(c.note, 300),
      })),
  assignedStaff: (v) => {
    const id = v ? String(v) : "";
    if (id && !mongoose.isValidObjectId(id)) throw httpError(400, "Neispravan zaduženi zaposleni.");
    return id || null;
  },
};

function parseProfilePatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(PROFILE_FIELDS)) if (has(body, key)) patch[key] = parse(body[key]);
  return patch;
}

/** Osnovni podaci su u Patient (jedan izvor): ime, prezime, datum rođenja, adresa */
function parsePatientPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of ["name", "lastName"] as const) {
    if (!has(body, key)) continue;
    const value = str(body[key], 100);
    if (!value) throw httpError(400, "Ime i prezime ne mogu biti prazni.");
    patch[key] = value;
  }
  if (has(body, "address")) patch.address = str(body.address, 200);
  if (has(body, "dateOfBirth")) patch.dateOfBirth = day(body.dateOfBirth, "Datum rođenja");
  return patch;
}

const contactSummary = (c: { name: string; relation?: string; phone?: string }) => [c.name, c.relation, c.phone].filter(Boolean).join(", ");

/**
 * Primenjuje izmene osnovnih podataka i profila. JMBG dopunjuje datum rođenja i pol kad nisu uneti,
 * a kontakti porodice postaju i "kontakt osoba" korisnika (vidi se svuda u aplikaciji).
 */
async function applyChanges(req: Request, patient: InstanceType<typeof Patient>, body: Record<string, unknown>) {
  const patientPatch = parsePatientPatch(obj(body.patient));
  const profilePatch = parseProfilePatch(obj(body.profile));
  if (profilePatch.assignedStaff && !(await User.exists({ _id: profilePatch.assignedStaff }))) throw httpError(400, "Zaduženi zaposleni ne postoji.");

  const existing = await SocialProfile.findOne({ patient: patient._id });
  const expected = body.expectedUpdatedAt;
  if (existing && typeof expected === "string" && existing.updatedAt && existing.updatedAt.toISOString() !== expected) {
    throw httpError(409, "Podatke je u međuvremenu promenio neko drugi. Osvežite stranicu i ponovite izmenu.");
  }

  // JMBG → datum rođenja i pol (ako nisu uneti), i provera da se slažu
  const jmbg = typeof profilePatch.jmbg === "string" ? profilePatch.jmbg : existing?.jmbg ?? "";
  const info = jmbg ? jmbgInfo(jmbg) : null;
  if (info) {
    const birth = has(patientPatch, "dateOfBirth") ? (patientPatch.dateOfBirth as Date | null) : normalizeStoredDay(patient.dateOfBirth ?? null);
    if (!birth) patientPatch.dateOfBirth = info.birthDate;
    else if (birth.getTime() !== info.birthDate.getTime()) throw httpError(400, "Datum rođenja se ne slaže sa JMBG-om.");
    const sex = has(profilePatch, "sex") ? profilePatch.sex : existing?.sex;
    if (!sex) profilePatch.sex = info.sex;
  }
  const birth = has(patientPatch, "dateOfBirth") ? (patientPatch.dateOfBirth as Date | null) : null;
  if (birth && birth > (normalizeStoredDay(patient.admissionDate) ?? new Date())) throw httpError(400, "Datum rođenja je posle datuma prijema.");

  if (Array.isArray(profilePatch.contacts)) {
    const contacts = profilePatch.contacts as Array<{ name: string; relation: string; phone: string; emergency: boolean }>;
    const main = contacts.find((c) => c.emergency) ?? contacts[0];
    patientPatch.contactPerson = main ? contactSummary(main) : "";
  }

  if (Object.keys(patientPatch).length) {
    patient.set(patientPatch);
    await patient.save();
  }
  let profile = existing;
  if (Object.keys(profilePatch).length || !existing) {
    try {
      profile = await SocialProfile.findOneAndUpdate(
        { patient: patient._id },
        { $set: { ...profilePatch, updatedBy: req.user._id }, $setOnInsert: { patient: patient._id } },
        { upsert: true, new: true, runValidators: true }
      );
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const other = await SocialProfile.findOne({ jmbg: profilePatch.jmbg, patient: { $ne: patient._id } }).populate<{ patient: { name: string; lastName: string } }>("patient", "name lastName");
        throw httpError(409, `JMBG je već unet kod korisnika ${other?.patient ? `${other.patient.name} ${other.patient.lastName}` : "u bazi"}.`);
      }
      throw err;
    }
  }
  const changed = [...Object.keys(patientPatch), ...Object.keys(profilePatch)];
  if (changed.length) await audit(req, "profile.update", patient._id, changed);
  return { patient, profile };
}

const populateProfile = (id: unknown) => SocialProfile.findOne({ patient: id }).populate("assignedStaff", "name lastName role");

// GET /api/social/profile/:patientId — profil je null dok se ne unese
export const getProfile = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    res.json({ success: true, patient, profile: await populateProfile(patient._id) });
  } catch (err) {
    fail(res, err);
  }
};

// PATCH /api/social/profile/:patientId { patient?: {...}, profile?: {...}, expectedUpdatedAt? }
export const saveProfile = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    await applyChanges(req, patient, obj(req.body));
    res.json({ success: true, patient, profile: await populateProfile(patient._id) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/social/residents { patient: { name, lastName, admissionDate, ... }, profile?: {...} }
// Novi korisnik sa osnovnim ili detaljnim podacima — obavezni su samo ime, prezime i datum prijema.
export const createResident = async (req: Request, res: Response) => {
  let created: InstanceType<typeof Patient> | null = null;
  try {
    const p = obj(req.body?.patient);
    const name = str(p.name, 100);
    const lastName = str(p.lastName, 100);
    if (!name || !lastName) throw httpError(400, "Unesite ime i prezime.");
    const admissionDate = day(p.admissionDate, "Datum prijema");
    if (!admissionDate) throw httpError(400, "Unesite datum prijema.");
    created = await Patient.create({ name, lastName, admissionDate, createdBy: req.user._id });
    await applyChanges(req, created, { patient: { ...p, name, lastName }, profile: req.body?.profile });
    await audit(req, "patient.create", created._id);
    res.status(201).json({ success: true, patient: created, profile: await populateProfile(created._id) });
  } catch (err) {
    // Ništa ne ostaje upola sačuvano: ako profil nije prošao, briše se i novi korisnik
    if (created) await Promise.all([Patient.deleteOne({ _id: created._id }), SocialProfile.deleteOne({ patient: created._id })]).catch(() => undefined);
    fail(res, err);
  }
};

// GET /api/social/history/:patientId — ko je i kada menjao podatke (bez vrednosti)
export const getHistory = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    const history = await AuditLog.find({ patient: patient._id }).sort({ createdAt: -1 }).limit(100).populate("user", "name lastName role").lean();
    res.json({ success: true, history });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/social/staff — zaposleni koji mogu biti zaduženi za korisnika (samo ime i uloga)
export const listStaff = async (_req: Request, res: Response) => {
  try {
    const staff = await User.find({
      role: { $in: ["social-worker", "main-nurse", "nurse", "physiotherapist", "doctor", "admin"] },
      status: { $ne: "suspended" },
      loginAllowed: { $ne: false },
    })
      .select("name lastName role")
      .sort({ lastName: 1, name: 1 })
      .lean();
    res.json({ success: true, staff });
  } catch (err) {
    fail(res, err);
  }
};

// ── Šabloni: polja i podaci ─────────────────────────────────────────────

// GET /api/social/merge-fields — katalog polja koja se mogu staviti u Word šablon
export const getMergeFields = (_req: Request, res: Response) => res.json({ success: true, fields: MERGE_FIELDS, lists: MERGE_LISTS });

// GET /api/social/merge-data/:patientId — podaci korisnika za popunjavanje šablona
export const getMergeData = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    const data = await buildMergeData(String(patient._id), req.user);
    await audit(req, "template.fill", patient._id, [], typeof req.query.template === "string" ? str(req.query.template, 120) : "");
    res.json({ success: true, ...data });
  } catch (err) {
    fail(res, err);
  }
};

// ── Dokumenti (procene i plan) ───────────────────────────────────────────

const populateDoc = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) =>
  q.populate("author", "name lastName role").populate("finalizedBy", "name lastName role");

function parseDocument(type: DocType, b: Record<string, unknown>) {
  const date = day(b.date, "Datum") ?? day(new Date(), "Datum")!;
  const raw = obj(b.sections);
  const sections: Record<string, string> = {};
  for (const key of DOC_SECTIONS[type]) {
    const value = str(raw[key], 10000);
    if (value) sections[key] = value;
  }
  const level = Number(b.supportLevel ?? 0);
  if (!Number.isInteger(level) || level < 0 || level > 4) throw httpError(400, "Stepen podrške je od I do IV.");
  const goals = (Array.isArray(b.goals) ? b.goals.slice(0, 30) : [])
    .map(obj)
    .filter((g) => str(g.goal, 500))
    .map((g) => ({
      area: str(g.area, 120),
      goal: str(g.goal, 500),
      outcome: str(g.outcome, 500),
      activities: str(g.activities, 2000),
      responsible: str(g.responsible, 200),
      due: day(g.due, "Rok aktivnosti"),
      status: oneOf(g.status ?? "", ["", "achieved", "partial", "not_achieved"] as const, "Ishod cilja"),
    }));
  const isPlan = type === "plan" || type === "plan_review";
  const nextReview = isPlan ? day(b.nextReview, "Rok za ponovni pregled") : null;
  if (nextReview && nextReview < date) throw httpError(400, "Rok za ponovni pregled je pre datuma dokumenta.");
  return {
    date,
    sections,
    supportLevel: type === "assessment" || type === "reassessment" ? level : 0,
    participants: str(b.participants, 1000),
    goals: isPlan ? goals : [],
    nextReview,
  };
}

// Nacrt menja autor ili uprava; zaključen dokument se ne menja
async function editableDoc(req: Request) {
  const doc = await SocialDocument.findById(param(req, "id")).catch(() => null);
  if (!doc) throw httpError(404, "Dokument nije pronađen.");
  if (doc.status === "final") throw httpError(409, "Dokument je zaključen i ne može se menjati. Napravite novu procenu ili pregled plana.");
  if (!isManagerRole(req.user.role) && String(doc.author) !== String(req.user._id)) throw httpError(403, "Nacrt može da menja autor ili uprava.");
  const expected = req.body?.expectedUpdatedAt;
  if (typeof expected === "string" && doc.updatedAt && doc.updatedAt.toISOString() !== expected) {
    throw httpError(409, "Nacrt je u međuvremenu promenio neko drugi. Zatvorite i otvorite ga ponovo.");
  }
  return doc;
}

// GET /api/social/documents?patientId=
export const listDocuments = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(req.query.patientId);
    const documents = await populateDoc(SocialDocument.find({ patient: patient._id }).sort({ date: -1, createdAt: -1 }));
    res.json({ success: true, documents });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/social/documents { patientId, type, ... }
export const createDocument = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(req.body?.patientId);
    const type = oneOf(req.body?.type, DOC_TYPES, "Vrsta dokumenta");
    const doc = await SocialDocument.create({ ...parseDocument(type, req.body ?? {}), type, patient: patient._id, author: req.user._id });
    await audit(req, "document.create", patient._id, [type]);
    res.status(201).json({ success: true, document: await populateDoc(SocialDocument.findById(doc._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /api/social/documents/:id
export const updateDocument = async (req: Request, res: Response) => {
  try {
    const doc = await editableDoc(req);
    doc.set(parseDocument(doc.type, req.body ?? {}));
    await doc.save();
    await audit(req, "document.update", doc.patient, [doc.type]);
    res.json({ success: true, document: await populateDoc(SocialDocument.findById(doc._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/social/documents/:id/finalize — zaključuje; procena prenosi stepen podrške u profil
export const finalizeDocument = async (req: Request, res: Response) => {
  try {
    const doc = await editableDoc(req);
    if (doc.type === "plan" && doc.goals.length === 0) throw httpError(400, "Individualni plan mora imati bar jedan cilj.");
    if (doc.type === "plan" && !doc.nextReview) throw httpError(400, "Unesite rok za ponovni pregled plana.");
    doc.set({ status: "final", finalizedBy: req.user._id, finalizedAt: new Date() });
    await doc.save();
    if ((doc.type === "assessment" || doc.type === "reassessment") && doc.supportLevel > 0) {
      await SocialProfile.findOneAndUpdate(
        { patient: doc.patient },
        { $set: { supportLevel: doc.supportLevel, updatedBy: req.user._id }, $setOnInsert: { patient: doc.patient } },
        { upsert: true }
      );
    }
    await audit(req, "document.finalize", doc.patient, [doc.type]);
    res.json({ success: true, document: await populateDoc(SocialDocument.findById(doc._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/social/documents/:id — samo nacrt
export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const doc = await editableDoc(req);
    await doc.deleteOne();
    await audit(req, "document.delete", doc.patient, [doc.type]);
    res.json({ success: true, message: "Nacrt je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};

// ── Rokovi ──────────────────────────────────────────────────────────────

/** Rokovi po Pravilniku: procena 10 dana od prijema (čl. 13), plan 10 dana od procene (čl. 16), pregled plana najkasnije za 12 meseci (čl. 17). */
export const PROCENA_DAYS = 10;
export const PLAN_DAYS = 10;

type Deadline = { patient: { _id: string; name: string; lastName: string }; kind: "assessment" | "plan" | "review"; due: Date; basis: string };

const addMonths = (d: Date, m: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + m);
  return r;
};

// GET /api/social/deadlines — sledeći korak za svakog korisnika na smeštaju
export const listDeadlines = async (_req: Request, res: Response) => {
  try {
    const patients = await Patient.find({ dischargeDate: null }).select("name lastName admissionDate").lean();
    const docs = await SocialDocument.find({ patient: { $in: patients.map((p) => p._id) }, status: "final" })
      .select("patient type date nextReview")
      .sort({ date: 1 })
      .lean();
    const byPatient = new Map<string, typeof docs>();
    for (const d of docs) {
      const k = String(d.patient);
      byPatient.set(k, [...(byPatient.get(k) ?? []), d]);
    }

    const deadlines: Deadline[] = [];
    for (const p of patients) {
      const list = byPatient.get(String(p._id)) ?? [];
      const patient = { _id: String(p._id), name: p.name, lastName: p.lastName };
      const assessments = list.filter((d) => d.type === "assessment" || d.type === "reassessment");
      const lastAssessment = assessments[assessments.length - 1];
      if (!lastAssessment) {
        deadlines.push({ patient, kind: "assessment", due: addDays(new Date(p.admissionDate), PROCENA_DAYS), basis: "10 dana od prijema" });
        continue;
      }
      if (!list.some((d) => d.type === "plan")) {
        deadlines.push({ patient, kind: "plan", due: addDays(new Date(lastAssessment.date), PLAN_DAYS), basis: "10 dana od procene" });
        continue;
      }
      const plans = list.filter((d) => d.type === "plan" || d.type === "plan_review");
      const base = plans[plans.length - 1]!;
      deadlines.push({ patient, kind: "review", due: base.nextReview ?? addMonths(new Date(base.date), 12), basis: base.nextReview ? "rok iz plana" : "12 meseci od plana" });
    }
    deadlines.sort((a, b) => a.due.getTime() - b.due.getTime());
    res.json({ success: true, deadlines });
  } catch (err) {
    fail(res, err);
  }
};
