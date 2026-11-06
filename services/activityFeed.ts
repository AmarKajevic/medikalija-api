// Jedinstvena lista aktivnosti (dijagnoze, artikli, lekovi) za kontrolnu tablu i
// pregled rada sestara. Ranije je ista logika bila kopirana u dva kontrolera.
import type { Types } from "mongoose";
import Diagnosis from "../models/Diagnosis.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedMedicine from "../models/UsedMedicine.js";
import type { NamedRef, PatientRef, UserRef } from "../models/populated.js";

export type ActivityType = "Dijagnoza" | "Artikal" | "Lek";

export interface ActivityItem {
  type: ActivityType;
  patient: string;
  createdBy: { _id: Types.ObjectId; name: string; lastName: string; role: string } | null;
  description: string;
  createdAt: Date;
}

interface ActivityQuery {
  /** Samo unosi ovog korisnika */
  createdBy?: Types.ObjectId | string;
  /** Samo unosi ove uloge (filtrira se posle učitavanja autora) */
  role?: string;
  /** Najviše ovoliko iz svake kolekcije i ukupno; bez ograničenja ako nije zadato */
  limit?: number;
}

const patientName = (p: PatientRef | null | undefined) => `${p?.name || ""} ${p?.lastName || ""}`.trim();

const author = (u: UserRef | null | undefined): ActivityItem["createdBy"] =>
  u ? { _id: u._id, name: u.name || "Nepoznato", lastName: u.lastName || "", role: u.role || "" } : null;

export async function loadActivity({ createdBy, role, limit }: ActivityQuery = {}): Promise<ActivityItem[]> {
  const match = createdBy ? { createdBy } : {};
  const capped = <Q extends { limit(n: number): Q }>(q: Q) => (limit ? q.limit(limit) : q);

  const [diagnoses, articles, medicines] = await Promise.all([
    capped(Diagnosis.find(match).sort({ createdAt: -1 }))
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName"),
    capped(UsedArticles.find(match).sort({ createdAt: -1 }))
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .populate<{ article: NamedRef | null }>("article", "name"),
    capped(UsedMedicine.find(match).sort({ createdAt: -1 }))
      .populate<{ createdBy: UserRef | null }>("createdBy", "name lastName role")
      .populate<{ patient: PatientRef | null }>("patient", "name lastName")
      .populate<{ medicine: NamedRef | null }>("medicine", "name"),
  ]);

  const activity: ActivityItem[] = [
    ...diagnoses.map((d) => ({
      type: "Dijagnoza" as const,
      patient: patientName(d.patient),
      createdBy: author(d.createdBy),
      description: d.description,
      createdAt: d.createdAt,
    })),
    ...articles.map((a) => ({
      type: "Artikal" as const,
      patient: patientName(a.patient),
      createdBy: author(a.createdBy),
      description: `${a.article?.name || "Nepoznat artikal"} — ${a.amount} kom`,
      createdAt: a.createdAt,
    })),
    ...medicines.map((m) => ({
      type: "Lek" as const,
      patient: patientName(m.patient),
      createdBy: author(m.createdBy),
      description: `${m.medicine?.name || "Nepoznat lek"} — ${m.amount} kom`,
      createdAt: m.createdAt,
    })),
  ]
    .filter((item) => !role || item.createdBy?.role === role)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return limit ? activity.slice(0, limit) : activity;
}
