// services/staffActivity.ts
//
// "Aktivnosti": šta je ko od osoblja dodao pacijentima, na jednom mestu.
//  - učinak rada / dijagnoza (sestre)
//  - unosi sestara i fizioterapeuta (lek, artikal, nega, fizikalna terapija) sa statusom
//    odobrenja — i ono što se ne naplaćuje (redovna fizioterapija, zabeleženo)
//  - lekovi, artikli i analize koje je uprava unela direktno u specifikaciju
//    (potrošnja nastala prihvatanjem unosa sestre se ne ponavlja — već je prikazana kao unos)
//  - beleške socijalnog radnika (samo naslov i kategorija, bez teksta)
import type { Types } from "mongoose";
import Diagnosis from "../models/Diagnosis.js";
import NurseEntry, { type EntryStatus } from "../models/NurseEntry.js";
import UsedMedicine from "../models/UsedMedicine.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedCombinations from "../models/UsedCombinations.js";
import SocialNote from "../models/SocialNote.js";
import type { NamedRef, PatientRef, UserRef } from "../models/populated.js";

export type ActivityKind = "note" | "medicine" | "article" | "care" | "physio" | "analysis" | "social";
/** Status unosa; "direct" = uprava je unela direktno u specifikaciju */
export type ActivityStatus = EntryStatus | "direct" | "note";

export interface StaffActivity {
  id: string;
  kind: ActivityKind;
  at: Date;
  /** Unos sestre/fizioterapeuta: kad je urađeno (može biti ranije od unosa) */
  performedAt?: Date;
  patient: { _id: Types.ObjectId; name: string; lastName: string } | null;
  by: { _id: Types.ObjectId; name: string; lastName: string; role: string } | null;
  title: string;
  detail: string;
  status: ActivityStatus;
}

export interface StaffActivityQuery {
  from?: Date;
  to?: Date;
  userId?: string;
  /** Najviše ovoliko iz svake vrste unosa (ukupna lista je sortirana i skraćena na isto) */
  limit?: number;
}

const SOCIAL_LABEL: Record<string, string> = {
  resident: "Korisnik",
  family: "Porodica",
  institution: "Institucije",
  documents: "Dokumenta",
  finance: "Finansije",
  activity: "Aktivnosti",
  other: "Ostalo",
};

const person = (u: UserRef | null | undefined) => (u ? { _id: u._id, name: u.name || "Nepoznato", lastName: u.lastName || "", role: u.role || "" } : null);
const patientOf = (p: PatientRef | null | undefined) => (p ? { _id: p._id, name: p.name, lastName: p.lastName } : null);
const qty = (n: number | null | undefined) => String(Math.round((Number(n) || 0) * 100) / 100).replace(".", ",");

export async function loadStaffActivity({ from, to, userId, limit = 1000 }: StaffActivityQuery = {}): Promise<StaffActivity[]> {
  const range: Record<string, Date> = {};
  if (from) range.$gte = from;
  if (to) range.$lt = to;
  const when = Object.keys(range).length ? { createdAt: range } : {};
  const match = { ...when, ...(userId ? { createdBy: userId } : {}) };

  const [notes, entries, medicines, articles, combinations, social] = await Promise.all([
    Diagnosis.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .lean(),
    NurseEntry.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .lean(),
    UsedMedicine.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .populate<{ medicine: NamedRef | null }>("medicine", "name")
      .lean(),
    UsedArticles.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .populate<{ article: NamedRef | null }>("article", "name")
      .lean(),
    UsedCombinations.find(match)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .populate<{ combination: NamedRef | null }>("combination", "name")
      .lean(),
    SocialNote.find({ ...when, ...(userId ? { author: userId } : {}) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate<{ author: UserRef | null }>("author", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .lean(),
  ]);

  // Potrošnja nastala prihvatanjem unosa sestre je već prikazana kao taj unos
  const usedIds = [...medicines, ...articles].map((u) => u._id);
  const fromEntries = new Set(
    usedIds.length ? (await NurseEntry.distinct("usedRecords", { usedRecords: { $in: usedIds } })).map(String) : []
  );

  const items: StaffActivity[] = [
    ...notes.map((d) => ({
      id: String(d._id),
      kind: "note" as const,
      at: d.createdAt,
      patient: patientOf(d.patient),
      by: person(d.createdBy),
      title: "Učinak rada / dijagnoza",
      detail: d.description,
      status: "note" as const,
    })),
    ...entries.map((e) => ({
      id: String(e._id),
      kind: e.type,
      at: e.createdAt,
      performedAt: e.performedAt,
      patient: patientOf(e.patient),
      by: person(e.createdBy),
      title: e.type === "physio" ? e.name : `${e.name} × ${qty(e.acceptedAmount ?? e.amount)}`,
      detail: [e.note, e.status === "rejected" && e.rejectReason ? `Odbijeno: ${e.rejectReason}` : ""].filter(Boolean).join(" · "),
      status: e.status === "processing" ? ("pending" as const) : e.status,
    })),
    ...medicines
      .filter((m) => !fromEntries.has(String(m._id)))
      .map((m) => ({
        id: String(m._id),
        kind: "medicine" as const,
        at: m.createdAt,
        patient: patientOf(m.patient),
        by: person(m.createdBy),
        title: `${m.medicine?.name || "Nepoznat lek"} × ${qty(m.amount)}`,
        detail: m.familyAmount ? `porodično: ${qty(m.familyAmount)}, dom: ${qty(m.homeAmount)}` : "",
        status: "direct" as const,
      })),
    ...articles
      .filter((a) => !fromEntries.has(String(a._id)))
      .map((a) => ({
        id: String(a._id),
        kind: "article" as const,
        at: a.createdAt,
        patient: patientOf(a.patient),
        by: person(a.createdBy),
        title: `${a.article?.name || "Nepoznat artikal"} × ${qty(a.amount)}`,
        detail: a.familyAmount ? `porodično: ${qty(a.familyAmount)}, dom: ${qty(a.homeAmount)}` : "",
        status: "direct" as const,
      })),
    ...combinations.map((c) => ({
      id: String(c._id),
      kind: "analysis" as const,
      at: c.createdAt,
      patient: patientOf(c.patient),
      by: person(c.createdBy),
      title: c.combination?.name || "Analize",
      detail: (c.analyses ?? []).map((a) => a.name).filter(Boolean).join(", "),
      status: "direct" as const,
    })),
    ...social.map((s) => ({
      id: String(s._id),
      kind: "social" as const,
      at: s.createdAt,
      patient: patientOf(s.patient),
      by: person(s.author),
      title: s.title || "Socijalna beleška",
      detail: SOCIAL_LABEL[s.category] ?? "",
      status: "note" as const,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return items.slice(0, limit);
}
