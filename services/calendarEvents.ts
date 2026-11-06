// services/calendarEvents.ts
//
// Čitanje i provera događaja kalendara:
//  - tumači stare zapise (celodnevni sa ekskluzivnim krajem) i nove (po satima / celodnevni)
//  - razvija ponavljanje u termine za traženi opseg, po ZIDNOM satu doma (Europe/Belgrade):
//    pregled "svakog utorka u 10:00" ostaje u 10:00 i posle prelaska na letnje/zimsko vreme
//  - proverava podatke iz zahteva pre upisa
import mongoose, { type Types } from "mongoose";
import CalendarEvent, { EVENT_CATEGORIES, LEGACY_CATEGORIES, type CalendarEventDoc } from "../models/CalendarEvent.js";
import Patient from "../models/Patient.js";
import { CLINIC_TIME_ZONE, DAY_MS, normalizeStoredDay, parseCalendarDay, toDateKey } from "../utils/dateUtils.js";
import { httpError } from "../utils/errors.js";

// ---------- vremenska zona doma ----------
const zoneFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CLINIC_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface WallTime {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
}

export function wallTime(instant: Date): WallTime {
  const parts = zoneFormatter.formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute") };
}

/** Zidni sat doma → trenutak (UTC). Nepostojeći sat (proleće, 02:30) pomera se napred. */
export function fromWallTime({ y, mo, d, h, mi }: WallTime): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const w = wallTime(new Date(t));
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - t;
  };
  const first = guess - offsetAt(guess);
  const second = guess - offsetAt(first);
  return new Date(second);
}

const utcDay = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo - 1, d));
const addDays = (day: Date, n: number) => new Date(day.getTime() + n * DAY_MS);
/** 0 = ponedeljak ... 6 = nedelja */
const weekdayOf = (day: Date) => (day.getUTCDay() + 6) % 7;

// ---------- tumačenje zapisa ----------
type Timing =
  | { allDay: true; startDay: Date; days: number }
  | { allDay: false; start: Date; durationMs: number };

type EventLike = Pick<CalendarEventDoc, "allDay" | "start" | "end">;

export function timingOf(e: EventLike): Timing {
  if (e.allDay === false) {
    const start = new Date(e.start);
    return { allDay: false, start, durationMs: Math.max(new Date(e.end).getTime() - start.getTime(), 0) };
  }
  const startDay = normalizeStoredDay(e.start)!;
  const endDay = normalizeStoredDay(e.end) ?? startDay;
  // Stari zapisi (allDay nije postavljen) imaju ekskluzivan kraj
  const days = e.allDay === true ? Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS) + 1 : Math.round((endDay.getTime() - startDay.getTime()) / DAY_MS);
  return { allDay: true, startDay, days: Math.max(days, 1) };
}

interface Rule {
  freq: "daily" | "weekly" | "monthly";
  interval?: number | null;
  byWeekday?: number[] | null;
  until?: Date | null;
  count?: number | null;
}

const MAX_CANDIDATES = 20_000;

/** Dani (UTC ponoć) u kojima niz ima termin, redom, počevši od prvog dana niza. */
function* seriesDays(baseDay: Date, rule: Rule): Generator<Date> {
  const interval = Math.max(rule.interval ?? 1, 1);
  let produced = 0;
  const done = (day: Date) => (rule.until && day.getTime() > rule.until.getTime()) || (rule.count && produced >= rule.count);

  if (rule.freq === "daily") {
    for (let k = 0; k < MAX_CANDIDATES; k++) {
      const day = addDays(baseDay, k * interval);
      if (done(day)) return;
      produced++;
      yield day;
    }
  } else if (rule.freq === "weekly") {
    const weekdays = [...new Set(rule.byWeekday?.length ? rule.byWeekday : [weekdayOf(baseDay)])].sort((a, b) => a - b);
    const weekStart = addDays(baseDay, -weekdayOf(baseDay));
    for (let w = 0; w < MAX_CANDIDATES / 7; w++) {
      for (const wd of weekdays) {
        const day = addDays(weekStart, w * interval * 7 + wd);
        if (day.getTime() < baseDay.getTime()) continue;
        if (done(day)) return;
        produced++;
        yield day;
      }
    }
  } else {
    const y0 = baseDay.getUTCFullYear();
    const m0 = baseDay.getUTCMonth();
    const d0 = baseDay.getUTCDate();
    for (let k = 0; k < MAX_CANDIDATES / 30; k++) {
      const monthIndex = m0 + k * interval;
      const day = new Date(Date.UTC(y0, monthIndex, d0));
      // 31. u mesecu od 30 dana se preskače (kao Google/Outlook), ne pomera se na 1.
      if (day.getUTCDate() !== d0) {
        if (rule.until && new Date(Date.UTC(y0, monthIndex, 1)).getTime() > rule.until.getTime()) return;
        continue;
      }
      if (done(day)) return;
      produced++;
      yield day;
    }
  }
}

export interface Occurrence {
  /** Jedinstven id termina (za ponavljanje: id niza + početak termina) */
  id: string;
  eventId: string;
  title: string;
  description: string;
  location: string;
  calendar: string;
  patient: { _id: string; name: string; lastName: string } | null;
  allDay: boolean;
  /** Celodnevni: "YYYY-MM-DD" (kraj uključiv); po satima: ISO trenutak */
  start: string;
  end: string;
  /** Početak ovog termina u nizu (ključ za izuzetke) */
  occurrenceStart: string;
  recurring: boolean;
  recurrence: Rule | null;
  /** Prvi termin niza, u istom obliku kao start/end (za izmenu celog niza) */
  series: { start: string; end: string } | null;
  /** Pojedinačno izmenjen termin iz niza */
  isException: boolean;
  createdBy: { _id: string; name: string; lastName: string } | null;
}

type Populated = CalendarEventDoc & {
  patient: { _id: Types.ObjectId; name: string; lastName: string } | null;
  userId: { _id: Types.ObjectId; name: string; lastName: string } | Types.ObjectId | null;
};

const categoryOf = (c: string) => LEGACY_CATEGORIES[c] ?? (EVENT_CATEGORIES.includes(c as never) ? c : "zelena");

function shape(e: Populated, timing: Timing, occStart: Date, occEnd: Date, first: { start: Date; end: Date }): Occurrence {
  const fmt = (d: Date, isEnd: boolean) => (timing.allDay ? toDateKey(isEnd ? addDays(d, -1) : d) : d.toISOString());
  const recurring = !!e.recurrence?.freq;
  const author = e.userId && typeof e.userId === "object" && "name" in e.userId ? e.userId : null;
  return {
    id: recurring ? `${e._id}_${occStart.getTime()}` : String(e._id),
    eventId: String(e._id),
    title: e.title,
    description: e.description ?? "",
    location: e.location ?? "",
    calendar: categoryOf(e.calendar),
    patient: e.patient && "name" in e.patient ? { _id: String(e.patient._id), name: e.patient.name, lastName: e.patient.lastName } : null,
    allDay: timing.allDay,
    start: fmt(occStart, false),
    end: fmt(occEnd, true),
    occurrenceStart: occStart.toISOString(),
    recurring,
    recurrence: recurring ? (e.recurrence as Rule) : null,
    series: recurring ? { start: fmt(first.start, false), end: fmt(first.end, true) } : null,
    isException: !!e.recurringEventId,
    createdBy: author ? { _id: String(author._id), name: author.name, lastName: author.lastName } : null,
  };
}

/** Termini događaja koji se preklapaju sa [from, to). Kraj celodnevnog termina je ekskluzivan. */
export function expandEvent(e: Populated, from: Date, to: Date): Occurrence[] {
  const timing = timingOf(e);
  const span = (day: Date): { start: Date; end: Date } => {
    if (timing.allDay) return { start: day, end: addDays(day, timing.days) };
    const t = wallTime(timing.start);
    const start = fromWallTime({ ...t, y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate() });
    return { start, end: new Date(start.getTime() + timing.durationMs) };
  };
  const baseDay = timing.allDay ? timing.startDay : (() => {
    const t = wallTime(timing.start);
    return utcDay(t.y, t.mo, t.d);
  })();
  const first = timing.allDay ? span(baseDay) : { start: timing.start, end: new Date(timing.start.getTime() + timing.durationMs) };
  const overlaps = (s: { start: Date; end: Date }) => s.end.getTime() > from.getTime() && s.start.getTime() < to.getTime();

  if (!e.recurrence?.freq) return overlaps(first) ? [shape(e, timing, first.start, first.end, first)] : [];

  const excluded = new Set((e.exdates ?? []).map((d) => new Date(d).getTime()));
  const out: Occurrence[] = [];
  for (const day of seriesDays(baseDay, e.recurrence as Rule)) {
    const s = day.getTime() === baseDay.getTime() ? first : span(day);
    if (s.start.getTime() >= to.getTime()) break;
    if (excluded.has(s.start.getTime()) || !overlaps(s)) continue;
    out.push(shape(e, timing, s.start, s.end, first));
  }
  return out;
}

/** Da li niz ima termin koji počinje tačno u `occurrenceStart` (pre izuzimanja). */
export function hasOccurrenceAt(e: Populated, occurrenceStart: Date): boolean {
  const t = occurrenceStart.getTime();
  const probe = { ...e.toObject(), exdates: [] } as unknown as Populated;
  return expandEvent(probe, new Date(t - DAY_MS), new Date(t + 2 * DAY_MS)).some((o) => new Date(o.occurrenceStart).getTime() === t);
}

export const MAX_RANGE_DAYS = 400;

export async function listOccurrences({ from, to, patientId }: { from: Date; to: Date; patientId?: string }): Promise<Occurrence[]> {
  if (to.getTime() <= from.getTime()) throw httpError(400, "Kraj opsega mora biti posle početka.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) throw httpError(400, "Opseg je prevelik.");

  const slack = new Date(from.getTime() - 2 * DAY_MS); // stari celodnevni zapisi su u lokalnoj ponoći
  const filter: Record<string, unknown> = {
    $or: [
      { recurrence: null, start: { $lt: to }, end: { $gte: slack } },
      { "recurrence.freq": { $exists: true }, start: { $lt: to }, $or: [{ "recurrence.until": null }, { "recurrence.until": { $gte: slack } }] },
    ],
  };
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) throw httpError(400, "Neispravan pacijent.");
    filter.patient = patientId;
  }

  const docs = (await CalendarEvent.find(filter)
    .populate("patient", "name lastName")
    .populate("userId", "name lastName")) as unknown as Populated[];

  return docs
    .flatMap((d) => expandEvent(d, from, to))
    .sort((a, b) => sortKey(a) - sortKey(b) || a.title.localeCompare(b.title, "sr"));
}

// Celodnevni termin se ređa na početak svog dana (po zidnom satu doma)
function sortKey(o: Occurrence) {
  if (!o.allDay) return new Date(o.start).getTime();
  const [y, mo, d] = o.start.split("-").map(Number);
  return fromWallTime({ y: y!, mo: mo!, d: d!, h: 0, mi: 0 }).getTime() - 1;
}

// ---------- provera unosa ----------
export interface EventInput {
  title: string;
  description: string;
  location: string;
  calendar: string;
  patient: Types.ObjectId | null;
  allDay: boolean;
  start: Date;
  end: Date;
  recurrence: Rule | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function parseEventInput(body: Record<string, unknown>): Promise<EventInput> {
  const title = text(body.title, 200);
  if (!title) throw httpError(400, "Unesite naziv događaja.");
  if (title.length > 160) throw httpError(400, "Naziv je predugačak (najviše 160 znakova).");

  const rawCategory = typeof body.calendar === "string" && body.calendar ? body.calendar : "zelena";
  const calendar = LEGACY_CATEGORIES[rawCategory] ?? rawCategory;
  if (!EVENT_CATEGORIES.includes(calendar as never)) throw httpError(400, "Nepoznata vrsta događaja.");

  const allDay = body.allDay === true;
  let start: Date;
  let end: Date;
  if (allDay) {
    const s = typeof body.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.start) ? parseCalendarDay(body.start) : null;
    const e = typeof body.end === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.end) ? parseCalendarDay(body.end) : null;
    if (!s || !e) throw httpError(400, "Celodnevni događaj traži datume u obliku GGGG-MM-DD.");
    if (e < s) throw httpError(400, "Kraj je pre početka.");
    if (e.getTime() - s.getTime() > 366 * DAY_MS) throw httpError(400, "Događaj ne može trajati duže od godinu dana.");
    [start, end] = [s, e];
  } else {
    start = new Date(String(body.start ?? ""));
    end = new Date(String(body.end ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError(400, "Neispravno vreme početka ili kraja.");
    if (end.getTime() <= start.getTime()) throw httpError(400, "Kraj mora biti posle početka.");
    if (end.getTime() - start.getTime() > 31 * DAY_MS) throw httpError(400, "Događaj po satima ne može trajati duže od 31 dan.");
  }

  let patient: Types.ObjectId | null = null;
  if (body.patientId) {
    if (!mongoose.isValidObjectId(body.patientId)) throw httpError(400, "Neispravan pacijent.");
    const found = await Patient.findById(body.patientId, { _id: 1 });
    if (!found) throw httpError(400, "Pacijent ne postoji.");
    patient = found._id;
  }

  return {
    title,
    description: text(body.description, 2000),
    location: text(body.location, 200),
    calendar,
    patient,
    allDay,
    start,
    end,
    recurrence: parseRecurrence(body.recurrence, allDay ? start : startDayInZone(start)),
  };
}

const startDayInZone = (instant: Date) => {
  const t = wallTime(instant);
  return utcDay(t.y, t.mo, t.d);
};

function parseRecurrence(raw: unknown, startDay: Date): Rule | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "object") throw httpError(400, "Neispravno ponavljanje.");
  const r = raw as Record<string, unknown>;
  if (r.freq === "none" || !r.freq) return null;
  if (!["daily", "weekly", "monthly"].includes(String(r.freq))) throw httpError(400, "Nepoznato ponavljanje.");

  const interval = r.interval === undefined ? 1 : Number(r.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) throw httpError(400, "Razmak ponavljanja mora biti od 1 do 99.");

  let byWeekday: number[] = [];
  if (r.freq === "weekly") {
    const list = Array.isArray(r.byWeekday) ? r.byWeekday.map(Number) : [];
    if (list.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw httpError(400, "Neispravan dan u nedelji.");
    byWeekday = list.length ? [...new Set(list)].sort((a, b) => a - b) : [weekdayOf(startDay)];
  }

  let until: Date | null = null;
  if (r.until) {
    until = typeof r.until === "string" ? parseCalendarDay(r.until) : null;
    if (!until) throw httpError(400, "Neispravan datum kraja ponavljanja.");
    if (until < startDay) throw httpError(400, "Ponavljanje se završava pre početka događaja.");
  }
  let count: number | null = null;
  if (r.count !== undefined && r.count !== null && r.count !== "") {
    count = Number(r.count);
    if (!Number.isInteger(count) || count < 1 || count > 500) throw httpError(400, "Broj ponavljanja mora biti od 1 do 500.");
  }
  if (until && count) throw httpError(400, "Izaberite ili datum kraja ili broj ponavljanja, ne oba.");

  return { freq: r.freq as Rule["freq"], interval, byWeekday, until, count };
}
