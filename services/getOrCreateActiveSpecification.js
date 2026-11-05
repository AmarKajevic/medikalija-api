import Specification from "../models/Specification.js";
import Patient from "../models/Patient.js";
import {
  addYears,
  diffInDays,
  normalizeStoredDay,
  nextPeriodAfter,
  parseCalendarDay,
  periodByIndex,
  periodIndexForDay,
  sameDayQuery,
  today,
} from "../utils/dateUtils.js";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Traži specifikaciju za tačan kalendarski opseg. Poređenje je tolerantno (±12h)
// jer stari zapisi u bazi mogu biti sačuvani kao lokalna ponoć (22:00Z/23:00Z)
// umesto kao UTC ponoć.
function findSpecForRange(patientId, startDate, endDate) {
  return Specification.findOne({
    patientId,
    startDate: sameDayQuery(startDate),
    endDate: sameDayQuery(endDate),
  });
}

// Vraća postojeću specifikaciju za opseg ili je kreira. Upsert je atomičan, pa
// dva paralelna zahteva (npr. dve sestre istovremeno dodaju lek) ne prave
// duplikat istog perioda.
async function findOrCreateSpecForRange(patientId, startDate, endDate) {
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
export async function getActiveSpecification(patientId) {
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
async function setActiveSpec(patientId, spec) {
  await Specification.updateMany(
    { patientId, _id: { $ne: spec._id }, isActive: true },
    { $set: { isActive: false } }
  );
  await Specification.updateOne({ _id: spec._id }, { $set: { isActive: true } });
  return Specification.findById(spec._id);
}

// Kreira (ili ponovo koristi postojeći) period po ručno unetom opsegu datuma
// i postavlja ga kao aktivan. Prihvata "YYYY-MM-DD" ili ISO datum sa vremenom.
export async function activateSpecificationPeriod(patientId, startDate, endDate) {
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
export async function activateNextSpecificationPeriod(patientId) {
  const active = await getActiveSpecification(patientId);
  if (!active) {
    throw httpError(409, "Pacijent nema aktivnu specifikaciju (otpušten ili ne postoji)");
  }

  const { startDate, endDate } = nextPeriodAfter(normalizeStoredDay(active.endDate));
  const spec = await findOrCreateSpecForRange(patientId, startDate, endDate);
  return setActiveSpec(patientId, spec);
}

// Reaktivira POSTOJEĆU specifikaciju po ID-u (npr. iz istorije), bez ikakvog
// poređenja ili računanja datuma.
export async function activateExistingSpecification(patientId, specId) {
  const spec = await Specification.findOne({ _id: specId, patientId });
  if (!spec) throw httpError(404, "Specifikacija nije pronađena");
  return setActiveSpec(patientId, spec);
}

// Period (iz mreže 30-dnevnih perioda od dana prijema) u koji pada današnji dan.
export async function getOrCreateActiveSpecification(patientId, patientDoc = null) {
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
export function buildSpecificationSchedule(admissionDate, untilDay, currentDay = today()) {
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
export function futureScheduleHorizon(admissionDate, currentDay = today()) {
  const admissionDay = normalizeStoredDay(admissionDate);
  const fromToday = addYears(currentDay, FUTURE_SCHEDULE_YEARS);
  const fromAdmission = admissionDay ? addYears(admissionDay, FUTURE_SCHEDULE_YEARS) : fromToday;
  return fromToday > fromAdmission ? fromToday : fromAdmission;
}
