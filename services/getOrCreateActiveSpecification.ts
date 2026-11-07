import Specification from "../models/Specification.js";
import Patient from "../models/Patient.js";
import { Types } from "mongoose";
import type { HydratedDocument } from "mongoose";
import type { SpecificationDoc } from "../models/Specification.js";
import { httpError } from "../utils/errors.js";

type Id = Types.ObjectId | string;
type PatientDoc = HydratedDocument<import("mongoose").InferSchemaType<typeof Patient.schema>>;
type DayInput = Date | string | number | null | undefined;
import {
  addDays,
  addYears,
  calendarDayInZone,
  SPEC_PERIOD_DAYS,
  diffInDays,
  normalizeStoredDay,
  nextPeriodAfter,
  parseCalendarDay,
  periodByIndex,
  periodIndexForDay,
  sameDayQuery,
  today,
} from "../utils/dateUtils.js";


// Traži specifikaciju za tačan kalendarski opseg. Poređenje je tolerantno (±12h)
// jer stari zapisi u bazi mogu biti sačuvani kao lokalna ponoć (22:00Z/23:00Z)
// umesto kao UTC ponoć.
function findSpecForRange(patientId: Id, startDate: Date, endDate: Date) {
  return Specification.findOne({
    patientId,
    startDate: sameDayQuery(startDate),
    endDate: sameDayQuery(endDate),
  });
}

// Vraća postojeću specifikaciju za opseg ili je kreira. Upsert je atomičan, pa
// dva paralelna zahteva (npr. dve sestre istovremeno dodaju lek) ne prave
// duplikat istog perioda.
async function findOrCreateSpecForRange(patientId: Id, startDate: Date, endDate: Date): Promise<SpecificationDoc> {
  const existing = await findSpecForRange(patientId, startDate, endDate);
  if (existing) return existing;

  return Specification.findOneAndUpdate(
    { patientId, startDate, endDate },
    // patientId/startDate/endDate se pri insertu preuzimaju iz filtera
    { $setOnInsert: { items: [], totalPrice: 0, isActive: false } },
    { new: true, upsert: true }
  );
}

// Vraća period koji je admin eksplicitno označio kao aktivan (isActive: true).
// Ako takav ne postoji (nov pacijent ili stari podaci bez flaga), samoispravljanje:
// koristi se period po admissionDate + "danas" i taj period se markira kao
// aktivan, tako da nema potrebe za posebnom migracionom skriptom.
export async function getActiveSpecification(patientId: Id): Promise<SpecificationDoc | null> {
  const patient = await Patient.findById(patientId);
  if (!patient) return null;
  if (patient.dischargeDate) return null;

  const existing = await Specification.findOne({ patientId, isActive: true });
  if (existing) return existing;

  const fallback = await getOrCreateActiveSpecification(patientId, patient);
  if (fallback) {
    return setActiveSpec(patientId, fallback);
  }
  return fallback;
}

// Deaktivira sve ostale specifikacije pacijenta i aktivira prosleđenu.
// Atomični update-i (ne `save()`), da paralelni zahtevi koji istovremeno
// aktiviraju isti period ne bi pali na proveri verzije dokumenta.
async function setActiveSpec(patientId: Id, spec: SpecificationDoc): Promise<SpecificationDoc> {
  await Specification.updateMany(
    { patientId, _id: { $ne: spec._id }, isActive: true },
    { $set: { isActive: false } }
  );
  await Specification.updateOne({ _id: spec._id }, { $set: { isActive: true } });
  const fresh = await Specification.findById(spec._id);
  if (!fresh) throw httpError(404, "Specifikacija nije pronađena");
  return fresh;
}

// Kreira (ili ponovo koristi postojeći) period po ručno unetom opsegu datuma
// i postavlja ga kao aktivan. Prihvata "YYYY-MM-DD" ili ISO datum sa vremenom.
export async function activateSpecificationPeriod(patientId: Id, startDate: unknown, endDate: unknown): Promise<SpecificationDoc> {
  const patient = await Patient.findById(patientId);
  if (!patient) throw httpError(404, "Pacijent nije pronađen");

  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);

  if (!start || !end || end < start) {
    throw httpError(400, "Neispravan opseg datuma");
  }

  const spec = await findOrCreateSpecForRange(patientId, start, end);
  return setActiveSpec(patientId, spec);
}

// Aktivira period koji se nadovezuje na trenutno aktivan (dan posle njegovog
// kraja + 30 dana). Računa se na serveru da frontend ne bi zavisio od
// vremenske zone browsera.
export async function activateNextSpecificationPeriod(patientId: Id): Promise<SpecificationDoc> {
  const active = await getActiveSpecification(patientId);
  if (!active) {
    throw httpError(409, "Pacijent nema aktivnu specifikaciju (otpušten ili ne postoji)");
  }

  // endDate je obavezno polje, pa normalizacija uvek vraća datum
  const { startDate, endDate } = nextPeriodAfter(normalizeStoredDay(active.endDate) ?? active.endDate);
  const spec = await findOrCreateSpecForRange(patientId, startDate, endDate);
  return setActiveSpec(patientId, spec);
}

// Reaktivira POSTOJEĆU specifikaciju po ID-u (npr. iz istorije), bez ikakvog
// poređenja ili računanja datuma.
export async function activateExistingSpecification(patientId: Id, specId: Id): Promise<SpecificationDoc> {
  const spec = await Specification.findOne({ _id: specId, patientId });
  if (!spec) throw httpError(404, "Specifikacija nije pronađena");
  return setActiveSpec(patientId, spec);
}

// Period specifikacije: period neposredno pre aktivnog — poslednji koji je istekao.
// Specifikacija se uglavnom obračunava kad period istekne, pa uprava najčešće radi
// u ovom periodu. Ako zapis ne postoji, pravi se po mreži od 30 dana (ne pre prijema).
export async function getBillingPeriodSpecification(patientId: Id, activeSpec?: SpecificationDoc | null): Promise<SpecificationDoc | null> {
  const active = activeSpec === undefined ? await getActiveSpecification(patientId) : activeSpec;
  if (!active) return null;
  const activeStart = normalizeStoredDay(active.startDate);
  if (!activeStart) return null;
  const end = addDays(activeStart, -1);

  const existing = await Specification.findOne({ patientId, _id: { $ne: active._id }, endDate: sameDayQuery(end) }).sort({ startDate: -1 });
  if (existing) return existing;

  const patient = await Patient.findById(patientId);
  const admission = normalizeStoredDay(patient?.admissionDate);
  if (!admission || end < admission) return null; // aktivan je prvi period
  const gridStart = addDays(end, -(SPEC_PERIOD_DAYS - 1));
  return findOrCreateSpecForRange(patientId, gridStart < admission ? admission : gridStart, end);
}

const inRange = (spec: SpecificationDoc, day: Date) => {
  const start = normalizeStoredDay(spec.startDate);
  const end = normalizeStoredDay(spec.endDate);
  return !!start && !!end && day >= start && day <= end;
};

// U koji period ide nova stavka:
//  - izričito izabran (specificationId): aktivan ili bilo koji raniji period pacijenta
//    (uprava ručno bira period), ali ne budući
//  - po datumu (at, npr. kad je sestra dala lek): period specifikacije ako datum pada u njega,
//    pa bilo koji postojeći raniji period u koji pada
//  - inače aktivan period
export async function resolveTargetSpecification(patientId: Id, { specificationId, at }: { specificationId?: unknown; at?: Date | null } = {}): Promise<SpecificationDoc> {
  const active = await getActiveSpecification(patientId);
  if (!active) throw httpError(409, "Pacijent nema aktivnu specifikaciju (otpušten je ili ne postoji).");

  if (specificationId) {
    if (String(active._id) === String(specificationId)) return active;
    if (!Types.ObjectId.isValid(String(specificationId))) throw httpError(400, "Neispravan period.");
    const chosen = await Specification.findOne({ _id: specificationId, patientId });
    if (!chosen) throw httpError(404, "Period nije pronađen.");
    const chosenStart = normalizeStoredDay(chosen.startDate);
    const activeStart = normalizeStoredDay(active.startDate);
    if (!chosenStart || !activeStart || chosenStart > activeStart) throw httpError(409, "Stavke se ne dodaju u budući period.");
    return chosen;
  }
  if (at) {
    const day = calendarDayInZone(at);
    const billing = await getBillingPeriodSpecification(patientId, active);
    if (billing && inRange(billing, day)) return billing;
    const activeStart = normalizeStoredDay(active.startDate);
    if (activeStart && day < activeStart) {
      const older = await Specification.find({ patientId, _id: { $ne: active._id } }).sort({ startDate: -1 });
      const match = older.find((s) => inRange(s, day));
      if (match) return match;
    }
  }
  return active;
}

// Period (iz mreže 30-dnevnih perioda od dana prijema) u koji pada današnji dan.
export async function getOrCreateActiveSpecification(patientId: Id, patientDoc: PatientDoc | null = null): Promise<SpecificationDoc | null> {
  const patient = patientDoc || (await Patient.findById(patientId));
  if (!patient) return null;

  // Ako pacijent ima ručni otpust → nikad ne pravimo novu specifikaciju
  if (patient.dischargeDate) return null;

  const admissionDay = normalizeStoredDay(patient.admissionDate);
  if (!admissionDay) return null;

  const index = periodIndexForDay(admissionDay, today());
  const { startDate, endDate } = periodByIndex(admissionDay, index);

  return findOrCreateSpecForRange(patientId, startDate, endDate);
}

// Raspored 30-dnevnih perioda od dana prijema do `untilDay` (uključivo).
// Svaki period ima tačno 30 kalendarskih dana; 29. februar u prestupnoj
// godini je običan dan u periodu, pa se raspored nikad ne "pomera".
export function buildSpecificationSchedule(admissionDate: DayInput, untilDay: Date, currentDay: Date = today()) {
  const admissionDay = normalizeStoredDay(admissionDate);
  if (!admissionDay || untilDay < admissionDay) return [];

  const currentIndex = diffInDays(admissionDay, currentDay) >= 0
    ? periodIndexForDay(admissionDay, currentDay)
    : -1;

  const periods = [];
  for (let i = 0; ; i++) {
    const { startDate, endDate } = periodByIndex(admissionDay, i);
    if (startDate > untilDay) break;

    periods.push({
      index: i + 1,
      startDate,
      endDate,
      isPast: i < currentIndex,
      isCurrent: i === currentIndex,
    });
  }
  return periods;
}

export const FUTURE_SCHEDULE_YEARS = 10;

// Datum do kog se prikazuju budući periodi: 10 kalendarskih godina od danas
// (sa prestupnim godinama), a najmanje 10 godina od prijema.
export function futureScheduleHorizon(admissionDate: DayInput, currentDay: Date = today()): Date {
  const admissionDay = normalizeStoredDay(admissionDate);
  const fromToday = addYears(currentDay, FUTURE_SCHEDULE_YEARS);
  const fromAdmission = admissionDay ? addYears(admissionDay, FUTURE_SCHEDULE_YEARS) : fromToday;
  return fromToday > fromAdmission ? fromToday : fromAdmission;
}

export interface PastPeriod {
  startDate: Date;
  endDate: Date;
  /** Zapis u bazi (null = period iz mreže koji još nije otvaran) */
  specificationId: string | null;
  itemsCount: number;
  totalPrice: number;
}

// Svi raniji periodi pacijenta, od prijema do aktivnog perioda, od najnovijeg ka najstarijem.
// Postojeći zapisi (i ručno napravljeni) imaju prednost; praznine se popunjavaju
// periodima od 30 dana iz mreže od dana prijema.
export async function listPastPeriods(patientId: Id): Promise<PastPeriod[]> {
  const patient = await Patient.findById(patientId);
  if (!patient) throw httpError(404, "Pacijent nije pronađen");
  const admission = normalizeStoredDay(patient.admissionDate);
  const active = patient.dischargeDate ? null : await getActiveSpecification(patientId);
  // Granica: početak aktivnog perioda; otpušten pacijent — dan posle otpusta
  const limit = normalizeStoredDay(active?.startDate) ?? addDays(normalizeStoredDay(patient.dischargeDate) ?? today(), 1);

  const specs = await Specification.find({ patientId, ...(active ? { _id: { $ne: active._id } } : {}) });
  const existing = specs
    .map((s) => ({ s, start: normalizeStoredDay(s.startDate), end: normalizeStoredDay(s.endDate) }))
    .filter((x): x is { s: SpecificationDoc; start: Date; end: Date } => !!x.start && !!x.end && x.start < limit);

  const result: PastPeriod[] = existing.map(({ s, start, end }) => ({
    startDate: start,
    endDate: end,
    specificationId: String(s._id),
    itemsCount: s.items.length,
    totalPrice: s.totalPrice ?? 0,
  }));

  if (admission) {
    const lastDay = addDays(limit, -1);
    for (const p of buildSpecificationSchedule(admission, lastDay)) {
      const end = p.endDate > lastDay ? lastDay : p.endDate;
      const overlaps = existing.some((x) => p.startDate <= x.end && end >= x.start);
      if (!overlaps) result.push({ startDate: p.startDate, endDate: end, specificationId: null, itemsCount: 0, totalPrice: 0 });
    }
  }
  return result.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
}

// Otvara raniji period (pravi zapis ako ne postoji) BEZ menjanja aktivnog perioda —
// uprava u njemu dodaje stavke i pravi obračun.
export async function openPastPeriod(patientId: Id, startDate: unknown, endDate: unknown): Promise<SpecificationDoc> {
  const patient = await Patient.findById(patientId);
  if (!patient) throw httpError(404, "Pacijent nije pronađen");
  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);
  if (!start || !end || end < start) throw httpError(400, "Neispravan opseg datuma");
  const active = patient.dischargeDate ? null : await getActiveSpecification(patientId);
  const activeStart = normalizeStoredDay(active?.startDate);
  if (activeStart && start >= activeStart) throw httpError(409, "Izaberite period pre aktivnog.");
  return findOrCreateSpecForRange(patientId, start, end);
}
