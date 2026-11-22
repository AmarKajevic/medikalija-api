import type { Request, Response } from "express";
import { currentStayFrom } from "../services/patientStay.js";
import { assertUniquePatientName, patientNameKey } from "../services/patientIdentity.js";
import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import SocialProfile, { APPLICANT_KINDS, DISCHARGE_REASONS, OBLIGOR_SOURCES, LEGAL_CAPACITY, MARITAL_STATUS, PAYERS, PENSION_TYPES, PLACEMENT_BASIS, ROOM_TYPES, SEX, USER_CATEGORIES } from "../models/SocialProfile.js";
import SocialDocument, { DOC_SECTIONS, DOC_TYPES, LEGACY_SECTIONS, type DocType } from "../models/SocialDocument.js";
import { SCALE_ITEMS, SCALE_MAX, SCALE_MIN, scaleSummary } from "../services/social/supportScale.js";
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
const jmbgOf = (label: string) => (v: unknown) => {
  const jmbg = str(v, 20).replace(/\s/g, "");
  if (jmbg && !isValidJmbg(jmbg)) throw httpError(400, `${label} nije ispravan (13 cifara, proverite kontrolnu cifru).`);
  return jmbg;
};
const PROFILE_FIELDS: Record<string, Parser> = {
  jmbg: jmbgOf("JMBG"),
  parentName: text(120),
  maidenName: text(80),
  fatherName: text(120),
  motherName: text(120),
  motherMaidenName: text(80),
  spouse: (v) => {
    const s = obj(v);
    return { name: str(s.name, 120), maidenName: str(s.maidenName, 80), address: str(s.address, 200) };
  },
  phone: text(60),
  email: text(120),
  messenger: text(60),
  payerNote: text(200),
  socialStatus: text(160),
  insuranceBasis: text(160),
  property: text(500),
  diagnosis: text(300),
  requestDate: (v) => day(v, "Datum zahteva"),
  applicant: (v) => {
    const a = obj(v);
    return {
      kind: oneOf(a.kind ?? "", APPLICANT_KINDS, "Podnosilac zahteva"),
      name: str(a.name, 120),
      relation: str(a.relation, 60),
      sex: oneOf(a.sex ?? "", SEX, "Pol podnosioca"),
      address: str(a.address, 200),
      jmbg: jmbgOf("JMBG podnosioca")(a.jmbg),
      idCardNumber: str(a.idCardNumber, 30),
      email: str(a.email, 120),
      phone: str(a.phone, 60),
      messenger: str(a.messenger, 60),
    };
  },
  obligor: (v) => {
    const o = obj(v);
    return {
      source: oneOf(o.source ?? "", OBLIGOR_SOURCES, "Obveznik ugovora"),
      name: str(o.name, 120),
      relation: str(o.relation, 60),
      address: str(o.address, 200),
      jmbg: jmbgOf("JMBG obveznika")(o.jmbg),
      idCardNumber: str(o.idCardNumber, 30),
      email: str(o.email, 120),
      phone: str(o.phone, 60),
      messenger: str(o.messenger, 60),
    };
  },
  socialHealth: (v) => {
    const h = obj(v);
    return {
      date: day(h.date, "Datum lista (obrazac 4)"),
      mobility: str(h.mobility, 2000),
      selfCare: str(h.selfCare, 2000),
      communication: str(h.communication, 2000),
      chronicIllness: str(h.chronicIllness, 2000),
      healthOther: str(h.healthOther, 2000),
      family: str(h.family, 2000),
      familyOther: str(h.familyOther, 2000),
      requestedBy: str(h.requestedBy, 2000),
      reasons: str(h.reasons, 2000),
      userAttitude: str(h.userAttitude, 2000),
      relativesAttitude: str(h.relativesAttitude, 2000),
      circumstances: str(h.circumstances, 2000),
      commission: str(h.commission, 2000),
    };
  },
  trustee: (v) => {
    const t = obj(v);
    return { name: str(t.name, 120), address: str(t.address, 200), idCardNumber: str(t.idCardNumber, 30), phone: str(t.phone, 60) };
  },
  contract: (v) => {
    const c = obj(v);
    const price = c.priceEUR === null || c.priceEUR === undefined || c.priceEUR === "" ? null : Number(c.priceEUR);
    if (price !== null && !(Number.isFinite(price) && price >= 0)) throw httpError(400, "Cena smeštaja mora biti 0 ili veća.");
    const categories = [...new Set((Array.isArray(c.categories) ? c.categories : []).map(Number))]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= USER_CATEGORIES)
      .sort((a, b) => a - b);
    return { roomType: oneOf(c.roomType ?? "", ROOM_TYPES, "Kategorija sobe"), categories, priceEUR: price === null ? null : Math.round(price * 100) / 100, bankAccount: str(c.bankAccount, 60) };
  },
  dischargeReason: (v) => {
    const n = Number(v ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > DISCHARGE_REASONS) throw httpError(400, "Osnov prestanka smeštaja: nepoznata vrednost.");
    return n;
  },
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
      address: str(g.address, 200),
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
    const nextName = String(patientPatch.name ?? patient.name);
    const nextLast = String(patientPatch.lastName ?? patient.lastName);
    if (patientNameKey(nextName, nextLast) !== patientNameKey(patient.name, patient.lastName)) {
      await assertUniquePatientName(String(patientPatch.name ?? patient.name), String(patientPatch.lastName ?? patient.lastName), patient._id);
    }
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
    await assertUniquePatientName(name, lastName);
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
    // U zapisnik ide samo stvarna popuna dokumenta (sa nazivom), ne i provera statusa obrazaca
    if (typeof req.query.template === "string" && req.query.template) await audit(req, "template.fill", patient._id, [], str(req.query.template, 120));
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
  // Raniji delovi (stari oblik dokumenta) se čuvaju dok se nacrt menja — ništa se ne gubi
  for (const key of new Set([...DOC_SECTIONS[type], ...LEGACY_SECTIONS[type]])) {
    const value = str(raw[key], 10000);
    if (value) sections[key] = value;
  }
  const scale: Record<string, { now: number | null; expected: number | null }> = {};
  if (type === "support_scale") {
    const rawScale = obj(b.scale);
    const score = (v: unknown, label: string) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < SCALE_MIN || n > SCALE_MAX) throw httpError(400, `${label}: ocena je od ${SCALE_MIN} do ${SCALE_MAX}.`);
      return n;
    };
    for (const key of SCALE_ITEMS) {
      const row = obj(rawScale[key]);
      const now = score(row.now, "Stanje na prijemu");
      const expected = score(row.expected, "Očekivani ishod");
      if (now !== null || expected !== null) scale[key] = { now, expected };
    }
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
  // Plan: planirani datum evaluacije; skala: datum ponovne procene
  const nextReview = isPlan || type === "support_scale" ? day(b.nextReview, type === "support_scale" ? "Datum ponovne procene" : "Rok za ponovni pregled") : null;
  if (nextReview && nextReview < date) throw httpError(400, "Rok za ponovni pregled je pre datuma dokumenta.");
  return {
    date,
    sections,
    // Skala: stepen se računa iz ocena (ne šalje se); raniji oblik procene: kako je unet
    supportLevel: type === "support_scale" ? scaleSummary(scale).level : type === "assessment" || type === "reassessment" ? level : 0,
    scale,
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
    const sections = doc.sections as unknown as Map<string, string>;
    if (doc.type === "plan" && doc.goals.length === 0 && !sections.get("goals")?.trim()) throw httpError(400, "Individualni plan mora imati ciljeve.");
    if (doc.type === "support_scale" && doc.supportLevel === 0) throw httpError(400, "Unesite ocene stanja na prijemu da bi se odredio stepen podrške.");
    if (doc.type === "plan" && !doc.nextReview) throw httpError(400, "Unesite rok za ponovni pregled plana.");
    doc.set({ status: "final", finalizedBy: req.user._id, finalizedAt: new Date() });
    await doc.save();
    if ((doc.type === "assessment" || doc.type === "reassessment" || doc.type === "support_scale") && doc.supportLevel > 0) {
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
    const patients = await Patient.find({ dischargeDate: null }).select("name lastName admissionDate previousStays").lean();
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
      // Posle ponovnog prijema važi samo dokumentacija tekućeg boravka
      const from = currentStayFrom(p);
      const list = (byPatient.get(String(p._id)) ?? []).filter((d) => !from || new Date(d.date) >= from);
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
