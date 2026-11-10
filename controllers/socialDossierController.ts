import type { Request, Response } from "express";
import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import User from "../models/User.js";
import SocialProfile, { LEGAL_CAPACITY, MARITAL_STATUS, PAYERS, PENSION_TYPES, PLACEMENT_BASIS, SEX } from "../models/SocialProfile.js";
import SocialDocument, { DOC_SECTIONS, DOC_TYPES, type DocType } from "../models/SocialDocument.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { addDays, parseCalendarDay } from "../utils/dateUtils.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

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

/** JMBG: 13 cifara i ispravna kontrolna cifra (prazno je dozvoljeno, npr. strani državljanin) */
export function isValidJmbg(jmbg: string): boolean {
  if (!/^\d{13}$/.test(jmbg)) return false;
  const d = [...jmbg].map(Number);
  const w = [7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, k, i) => s + k * (d[i]! + d[i + 6]!), 0);
  let m = 11 - (sum % 11);
  if (m > 9) m = 0;
  return m === d[12];
}

async function patientOr404(id: unknown) {
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Neispravan pacijent.");
  const patient = await Patient.findById(id).select("name lastName dateOfBirth address admissionDate dischargeDate contactPerson");
  if (!patient) throw httpError(404, "Pacijent nije pronađen.");
  return patient;
}

// ── Profil ──────────────────────────────────────────────────────────────

function parseProfile(b: Record<string, unknown>) {
  const jmbg = str(b.jmbg, 13).replace(/\s/g, "");
  if (jmbg && !isValidJmbg(jmbg)) throw httpError(400, "JMBG nije ispravan (13 cifara, proverite kontrolnu cifru).");
  const sub = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const guardian = sub(b.guardian);
  const trusted = sub(b.trustedPerson);
  const contacts = Array.isArray(b.contacts) ? b.contacts.slice(0, 20) : [];
  const assigned = b.assignedStaff ? String(b.assignedStaff) : "";
  if (assigned && !mongoose.isValidObjectId(assigned)) throw httpError(400, "Neispravan zaduženi zaposleni.");
  return {
    jmbg,
    parentName: str(b.parentName, 120),
    birthPlace: str(b.birthPlace, 120),
    sex: oneOf(b.sex ?? "", SEX, "Pol"),
    citizenship: str(b.citizenship, 60),
    nationality: str(b.nationality, 60),
    language: str(b.language, 60),
    religion: str(b.religion, 60),
    maritalStatus: oneOf(b.maritalStatus ?? "", MARITAL_STATUS, "Bračni status"),
    education: str(b.education, 120),
    occupation: str(b.occupation, 120),
    idCardNumber: str(b.idCardNumber, 30),
    healthInsuranceNumber: str(b.healthInsuranceNumber, 30),
    chosenDoctor: str(b.chosenDoctor, 120),
    municipality: str(b.municipality, 120),
    pensionType: oneOf(b.pensionType ?? "", PENSION_TYPES, "Vrsta penzije"),
    incomeNote: str(b.incomeNote, 300),
    payer: oneOf(b.payer ?? "", PAYERS, "Ko plaća smeštaj"),
    legalCapacity: oneOf(b.legalCapacity ?? "", LEGAL_CAPACITY, "Poslovna sposobnost"),
    guardian: {
      name: str(guardian.name, 120),
      relation: str(guardian.relation, 60),
      phone: str(guardian.phone, 60),
      decisionNumber: str(guardian.decisionNumber, 60),
      decisionDate: day(guardian.decisionDate, "Datum rešenja o starateljstvu"),
      authority: str(guardian.authority, 160),
    },
    trustedPerson: { name: str(trusted.name, 120), relation: str(trusted.relation, 60), phone: str(trusted.phone, 60) },
    placementBasis: oneOf(b.placementBasis ?? "", PLACEMENT_BASIS, "Osnov smeštaja"),
    contractNumber: str(b.contractNumber, 60),
    contractDate: day(b.contractDate, "Datum ugovora"),
    csrName: str(b.csrName, 160),
    caseManager: str(b.caseManager, 120),
    csrDecisionNumber: str(b.csrDecisionNumber, 60),
    csrDecisionDate: day(b.csrDecisionDate, "Datum rešenja CSR-a"),
    contacts: contacts
      .map((c) => sub(c))
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
    assignedStaff: assigned || null,
  };
}

// GET /api/social/profile/:patientId — prazan profil ako još ne postoji
export const getProfile = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    const profile = await SocialProfile.findOne({ patient: patient._id }).populate("assignedStaff", "name lastName role");
    res.json({ success: true, patient, profile });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /api/social/profile/:patientId
export const saveProfile = async (req: Request, res: Response) => {
  try {
    const patient = await patientOr404(param(req, "patientId"));
    const data = parseProfile(req.body ?? {});
    if (data.assignedStaff && !(await User.exists({ _id: data.assignedStaff }))) throw httpError(400, "Zaduženi zaposleni ne postoji.");
    const profile = await SocialProfile.findOneAndUpdate(
      { patient: patient._id },
      { $set: { ...data, updatedBy: req.user._id }, $setOnInsert: { patient: patient._id } },
      { upsert: true, new: true, runValidators: true }
    ).populate("assignedStaff", "name lastName role");
    res.json({ success: true, profile });
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

// ── Dokumenti (procene i plan) ───────────────────────────────────────────

const populateDoc = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) =>
  q.populate("author", "name lastName role").populate("finalizedBy", "name lastName role");

function parseDocument(type: DocType, b: Record<string, unknown>) {
  const date = day(b.date, "Datum") ?? day(new Date(), "Datum")!;
  const raw = b.sections && typeof b.sections === "object" ? (b.sections as Record<string, unknown>) : {};
  const sections: Record<string, string> = {};
  for (const key of DOC_SECTIONS[type]) {
    const text = str(raw[key], 10000);
    if (text) sections[key] = text;
  }
  const level = Number(b.supportLevel ?? 0);
  if (!Number.isInteger(level) || level < 0 || level > 4) throw httpError(400, "Stepen podrške je od I do IV.");
  const goals = (Array.isArray(b.goals) ? b.goals.slice(0, 30) : [])
    .map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>) : {}))
    .filter((g) => str(g.goal, 500))
    .map((g) => ({
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
    const addMonths = (d: Date, m: number) => {
      const r = new Date(d);
      r.setUTCMonth(r.getUTCMonth() + m);
      return r;
    };

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
      const plans = list.filter((d) => (d.type === "plan" || d.type === "plan_review") && d.date >= lastAssessment.date);
      const lastPlan = plans[plans.length - 1];
      if (!list.some((d) => d.type === "plan")) {
        deadlines.push({ patient, kind: "plan", due: addDays(new Date(lastAssessment.date), PLAN_DAYS), basis: "10 dana od procene" });
        continue;
      }
      const base = lastPlan ?? [...list].reverse().find((d) => d.type === "plan" || d.type === "plan_review")!;
      deadlines.push({ patient, kind: "review", due: base.nextReview ?? addMonths(new Date(base.date), 12), basis: base.nextReview ? "rok iz plana" : "12 meseci od plana" });
    }
    deadlines.sort((a, b) => a.due.getTime() - b.due.getTime());
    res.json({ success: true, deadlines });
  } catch (err) {
    fail(res, err);
  }
};
