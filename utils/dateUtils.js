// utils/dateUtils.js
//
// Jedinstveno mesto za rad sa KALENDARSKIM DANIMA (prijem, otpust, periodi
// specifikacija).
//
// Konvencija: kalendarski dan se uvek čuva kao UTC ponoć tog dana
// (npr. 15.03.2026 -> 2026-03-15T00:00:00.000Z).
//
// Zašto: UTC nema letnje/zimsko računanje vremena, pa je "dan" uvek tačno
// 86 400 000 ms. Sabiranje dana je tada čista aritmetika: prestupne godine
// (29. februar) i meseci različite dužine se uračunavaju sami od sebe, a
// rezultat ne zavisi od vremenske zone servera (Vercel = UTC, lokalno = Beograd).
//
// Stara logika je koristila `setDate()` / `setHours()` u LOKALNOJ zoni servera
// nad datumima koji su sa frontenda stizali kao beogradska ponoć
// (npr. 2026-06-09T22:00:00.000Z). Posle prelaska na zimsko računanje vremena
// to je postajalo 23:00 prethodnog dana, pa je jedan period imao 29 dana i svi
// sledeći su bili pomereni za dan.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const SPEC_PERIOD_DAYS = 30;
export const CLINIC_TIME_ZONE = process.env.APP_TIME_ZONE || "Europe/Belgrade";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const zoneFormatterCache = new Map();
function getZoneFormatter(timeZone) {
  if (!zoneFormatterCache.has(timeZone)) {
    zoneFormatterCache.set(
      timeZone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    );
  }
  return zoneFormatterCache.get(timeZone);
}

function utcDay(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day));
}

export function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

// Kalendarski dan (UTC ponoć) kome trenutak `instant` pripada u zoni `timeZone`.
export function calendarDayInZone(instant, timeZone = CLINIC_TIME_ZONE) {
  const parts = getZoneFormatter(timeZone).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return utcDay(get("year"), get("month") - 1, get("day"));
}

// Današnji kalendarski dan u zoni klinike (ne u zoni servera).
export function today() {
  return calendarDayInZone(new Date());
}

// Parsira datum koji je UNEO KORISNIK (body zahteva) u kalendarski dan.
//  - "YYYY-MM-DD" -> tačno taj dan (nepostojeći dani poput 2026-02-29 se odbijaju)
//  - ISO sa vremenom / Date -> dan kome taj trenutak pripada u zoni klinike
//    (flatpickr šalje lokalnu ponoć, npr. "2026-03-14T23:00:00.000Z" = 15.03.)
// Vraća null za prazan ili neispravan ulaz.
export function parseCalendarDay(input) {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "string") {
    const m = DATE_ONLY_RE.exec(input.trim());
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
      const day = utcDay(y, mo, d);
      const roundTrips =
        day.getUTCFullYear() === y && day.getUTCMonth() === mo && day.getUTCDate() === d;
      return roundTrips ? day : null;
    }
  }

  const instant = input instanceof Date ? input : new Date(input);
  if (!isValidDate(instant)) return null;
  return calendarDayInZone(instant);
}

// Normalizuje datum koji je VEĆ U BAZI na kalendarski dan, zaokruživanjem na
// najbližu UTC ponoć. Pokriva sve oblike u kojima su dani do sada čuvani:
//   2026-06-09T22:00Z (beogradska ponoć leti)  -> 2026-06-10
//   2026-03-14T23:00Z (beogradska ponoć zimi)  -> 2026-03-15
//   2026-11-06T22:00Z (pomeren DST-om)         -> 2026-11-07
//   2026-03-15T00:00Z (već normalizovan)       -> 2026-03-15
// NE koristiti za proizvoljne trenutke (npr. `new Date()`), za to je `today()`.
export function normalizeStoredDay(value) {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!isValidDate(d)) return null;
  return new Date(Math.round(d.getTime() / DAY_MS) * DAY_MS);
}

export function addDays(day, days) {
  return new Date(day.getTime() + days * DAY_MS);
}

// Broj kalendarskih dana od `from` do `to` (oba kalendarski dani).
export function diffInDays(from, to) {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

// Dodaje kalendarske godine. 29.02. + 1 godina = 28.02. (ne 01.03.).
export function addYears(day, years) {
  const y = day.getUTCFullYear() + years;
  const m = day.getUTCMonth();
  const lastDayOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return utcDay(y, m, Math.min(day.getUTCDate(), lastDayOfMonth));
}

// Opseg od SPEC_PERIOD_DAYS dana, uključujući i prvi i poslednji dan.
export function periodStartingAt(startDay) {
  return {
    startDate: startDay,
    endDate: addDays(startDay, SPEC_PERIOD_DAYS - 1),
  };
}

// N-ti period (od 0) u mreži 30-dnevnih perioda koja počinje danom prijema.
export function periodByIndex(anchorDay, index) {
  return periodStartingAt(addDays(anchorDay, index * SPEC_PERIOD_DAYS));
}

// Indeks perioda (od 0) u koji pada `day`. Dan pre prijema daje period 0.
export function periodIndexForDay(anchorDay, day) {
  return Math.max(0, Math.floor(diffInDays(anchorDay, day) / SPEC_PERIOD_DAYS));
}

// Period koji se nadovezuje na period koji se završava sa `endDay`.
export function nextPeriodAfter(endDay) {
  return periodStartingAt(addDays(endDay, 1));
}

// Mongo uslov koji pogađa isti kalendarski dan bez obzira na to da li je u bazi
// sačuvan kao UTC ponoć ili kao stara lokalna ponoć (±12h).
export function sameDayQuery(day) {
  const half = DAY_MS / 2;
  return { $gte: new Date(day.getTime() - half), $lt: new Date(day.getTime() + half) };
}

export function toDateKey(day) {
  return day.toISOString().slice(0, 10);
}
