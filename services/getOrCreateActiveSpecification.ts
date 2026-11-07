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
  diffInDays,
  calendarDayInZone,
  SPEC_PERIOD_DAYS,
  normalizeStoredDay,
  nextPeriodAfter,
  parseCalendarDay,
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

// ---------- Lanac perioda ----------
// Svaki period počinje dan posle kraja prethodnog. Postojeći zapisi (i ručno uneti,
// npr. skraćen period 02.09–25.09) važe tačno kako su uneti; praznine između njih
// popunjavaju se periodima od 30 dana. Tako ručna izmena pomera sve što sledi
// (posle 25.09. sledeći period počinje 26.09.), umesto fiksne mreže od dana prijema.
export interface ChainPeriod {
  startDate: Date;
  endDate: Date;
  spec: SpecificationDoc | null;
}

interface DatedSpec {
  spec: SpecificationDoc;
  start: Date;
  end: Date;
}

const dated = (specs: SpecificationDoc[]): DatedSpec[] =>
  specs
    .map((spec) => ({ spec, start: normalizeStoredDay(spec.startDate), end: normalizeStoredDay(spec.endDate) }))
    .filter((x): x is DatedSpec => !!x.start && !!x.end && x.end >= x.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());

/** Lanac od prijema (ili najranijeg zapisa) do `untilDay`; `skipped` = zapisi koji se preklapaju sa lancem */
export function buildPeriodChain(admission: Date | null, specs: SpecificationDoc[], untilDay: Date): { periods: ChainPeriod[]; skipped: SpecificationDoc[] } {
  const records = dated(specs);
  const first = records[0]?.start;
  let cursor = admission && first ? (first < admission ? first : admission) : (admission ?? first);
  const periods: ChainPeriod[] = [];
  const skipped: SpecificationDoc[] = [];
  if (!cursor) return { periods, skipped };

  let i = 0;
  while (cursor <= untilDay) {
    while (i < records.length && records[i]!.end < cursor) skipped.push(records[i++]!.spec);
    const next = records[i];
    if (next && next.start <= cursor) {
      periods.push({ startDate: next.start, endDate: next.end, spec: next.spec });
      cursor = addDays(next.end, 1);
      i++;
      continue;
    }
    let end = addDays(cursor, SPEC_PERIOD_DAYS - 1);
    if (next && end >= next.start) end = addDays(next.start, -1);
    periods.push({ startDate: cursor, endDate: end, spec: null });
    cursor = addDays(end, 1);
  }
  return { periods, skipped };
}

async function loadPeriodChain(patientId: Id, untilDay: Date, patientDoc?: PatientDoc | null) {
  const patient = patientDoc ?? (await Patient.findById(patientId));
  const specs = await Specification.find({ patientId });
  return buildPeriodChain(normalizeStoredDay(patient?.admissionDate), specs, untilDay);
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
// u ovom periodu. Ako zapis ne postoji, pravi se po lancu perioda (ne pre prijema).
export async function getBillingPeriodSpecification(patientId: Id, activeSpec?: SpecificationDoc | null): Promise<SpecificationDoc | null> {
  const active = activeSpec === undefined ? await getActiveSpecification(patientId) : activeSpec;
  if (!active) return null;
  const activeStart = normalizeStoredDay(active.startDate);
  if (!activeStart) return null;
  const end = addDays(activeStart, -1);

  const existing = await Specification.findOne({ patientId, _id: { $ne: active._id }, endDate: sameDayQuery(end) }).sort({ startDate: -1 });
  if (existing) return existing;

  // Inače: period iz lanca koji se završava dan pre aktivnog
  const { periods } = await loadPeriodChain(patientId, end);
  const last = periods[periods.length - 1];
  if (!last || last.spec?._id.equals(active._id)) return null; // aktivan je prvi period
  return last.spec ?? findOrCreateSpecForRange(patientId, last.startDate, last.endDate > end ? end : last.endDate);
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

  const { periods } = await loadPeriodChain(patientId, today(), patient);
  const current = periods[periods.length - 1];
  if (!current) return null;
  return current.spec ?? findOrCreateSpecForRange(patientId, current.startDate, current.endDate);
}

// Raspored 30-dnevnih perioda od dana prijema do `untilDay` (uključivo).
// Svaki period ima tačno 30 kalendarskih dana; 29. februar u prestupnoj
// godini je običan dan u periodu, pa se raspored nikad ne "pomera".
// Raspored perioda do `untilDay` po lancu (postojeći zapisi pacijenta pomeraju ono što sledi)
export function buildSpecificationSchedule(admissionDate: DayInput, untilDay: Date, currentDay: Date = today(), specs: SpecificationDoc[] = []) {
  const { periods } = buildPeriodChain(normalizeStoredDay(admissionDate), specs, untilDay);
  return periods.map((p, i) => ({
    index: i + 1,
    startDate: p.startDate,
    endDate: p.endDate,
    isPast: p.endDate < currentDay,
    isCurrent: p.startDate <= currentDay && currentDay <= p.endDate,
  }));
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

// Svi raniji periodi pacijenta, od prijema do aktivnog perioda, od najnovijeg ka najstarijem
// (po lancu perioda: ručno uneti datumi pomeraju sve što sledi).
export async function listPastPeriods(patientId: Id): Promise<PastPeriod[]> {
  const patient = await Patient.findById(patientId);
  if (!patient) throw httpError(404, "Pacijent nije pronađen");
  const active = patient.dischargeDate ? null : await getActiveSpecification(patientId);
  // Granica: početak aktivnog perioda; otpušten pacijent — dan posle otpusta
  const limit = normalizeStoredDay(active?.startDate) ?? addDays(normalizeStoredDay(patient.dischargeDate) ?? today(), 1);

  const { periods, skipped } = await loadPeriodChain(patientId, addDays(limit, -1), patient);
  const isActive = (spec: SpecificationDoc | null) => !!active && !!spec && spec._id.equals(active._id);
  const result: PastPeriod[] = periods
    .filter((p) => p.startDate < limit && !isActive(p.spec))
    .map((p) => ({
      startDate: p.startDate,
      endDate: p.endDate,
      specificationId: p.spec ? String(p.spec._id) : null,
      itemsCount: p.spec?.items.length ?? 0,
      totalPrice: p.spec?.totalPrice ?? 0,
    }));
  // Zapisi koji se preklapaju sa lancem (stari podaci) se ne kriju
  for (const spec of skipped) {
    const start = normalizeStoredDay(spec.startDate);
    const end = normalizeStoredDay(spec.endDate);
    if (start && end && start < limit && !isActive(spec))
      result.push({ startDate: start, endDate: end, specificationId: String(spec._id), itemsCount: spec.items.length, totalPrice: spec.totalPrice ?? 0 });
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

const fmtDay = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}.`;

// Ručna izmena datuma perioda (npr. 02.09–01.10 → 02.09–25.09).
//  - periodi koji se nadovezuju iza njega pomeraju se za istu razliku, pa sledeći
//    počinje dan posle novog kraja (26.09.), a dužine im ostaju iste
//  - prethodni period koji se završavao dan pre starog početka prati novi početak
//  - prazan period koji bi se preklopio se uklanja; period sa stavkama se ne dira (greška)
export async function changeSpecificationDates(patientId: Id, specId: unknown, startDate: unknown, endDate: unknown): Promise<SpecificationDoc> {
  if (!Types.ObjectId.isValid(String(specId))) throw httpError(400, "Neispravan period.");
  const start = parseCalendarDay(startDate);
  const end = parseCalendarDay(endDate);
  if (!start || !end || end < start) throw httpError(400, "Neispravan opseg datuma");

  const all = dated(await Specification.find({ patientId }));
  const target = all.find((x) => x.spec._id.equals(String(specId)));
  if (!target) throw httpError(404, "Specifikacija nije pronađena");

  const changes = new Map<string, { spec: SpecificationDoc; start: Date; end: Date }>();
  changes.set(String(target.spec._id), { spec: target.spec, start, end });

  // Periodi koji se nadovezuju iza (lanac bez rupa) pomeraju se za razliku u kraju
  const shift = diffInDays(target.end, end);
  if (shift !== 0) {
    let prevEnd = target.end;
    for (;;) {
      const next = all.find((x) => !changes.has(String(x.spec._id)) && x.start.getTime() === addDays(prevEnd, 1).getTime());
      if (!next) break;
      changes.set(String(next.spec._id), { spec: next.spec, start: addDays(next.start, shift), end: addDays(next.end, shift) });
      prevEnd = next.end;
    }
  }

  // Prethodni period koji se nadovezivao prati novi početak
  if (start.getTime() !== target.start.getTime()) {
    const prev = all.find((x) => !changes.has(String(x.spec._id)) && x.end.getTime() === addDays(target.start, -1).getTime());
    if (prev) {
      const prevEnd = addDays(start, -1);
      if (prevEnd >= prev.start) changes.set(String(prev.spec._id), { spec: prev.spec, start: prev.start, end: prevEnd });
    }
  }

  // Preklapanja sa ostalim zapisima
  const changed = [...changes.values()];
  const toDelete: SpecificationDoc[] = [];
  for (const other of all) {
    if (changes.has(String(other.spec._id))) continue;
    const clash = changed.find((c) => c.start <= other.end && c.end >= other.start);
    if (!clash) continue;
    if (other.spec.items.length > 0 || other.spec.isActive)
      throw httpError(409, `Preklapa se sa periodom ${fmtDay(other.start)} – ${fmtDay(other.end)} koji ima stavke. Prvo izmenite taj period.`);
    toDelete.push(other.spec);
  }

  if (toDelete.length) await Specification.deleteMany({ _id: { $in: toDelete.map((s) => s._id) } });
  for (const c of changed) await Specification.updateOne({ _id: c.spec._id }, { $set: { startDate: c.start, endDate: c.end } });
  const fresh = await Specification.findById(target.spec._id);
  if (!fresh) throw httpError(404, "Specifikacija nije pronađena");
  return fresh;
}
