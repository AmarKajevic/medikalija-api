// Pokretanje: npm test
// Rezultat ne sme da zavisi od zone servera, pa probati i:
//   TZ=UTC npm test   |   TZ=Europe/Belgrade npm test   |   TZ=America/New_York npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addYears,
  calendarDayInZone,
  diffInDays,
  nextPeriodAfter,
  normalizeStoredDay,
  parseCalendarDay,
  periodIndexForDay,
  sameDayQuery,
  toDateKey,
} from "../utils/dateUtils.js";
import {
  buildSpecificationSchedule,
  futureScheduleHorizon,
} from "../services/getOrCreateActiveSpecification.js";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
// U testovima null znači grešku — prikazuje se kao "null" u poređenju
const key = (d: Date | null) => (d ? toDateKey(d) : "null");

test("parseCalendarDay: YYYY-MM-DD je tačno taj dan, nepostojeći dani se odbijaju", () => {
  assert.equal(key(parseCalendarDay("2026-03-15")), "2026-03-15");
  assert.equal(key(parseCalendarDay("2028-02-29")), "2028-02-29");
  assert.equal(parseCalendarDay("2026-02-29"), null);
  assert.equal(parseCalendarDay("2026-13-01"), null);
  assert.equal(parseCalendarDay("nije datum"), null);
  assert.equal(parseCalendarDay(""), null);
  assert.equal(parseCalendarDay(null), null);
});

test("parseCalendarDay: lokalna ponoć iz flatpickr-a je dan u Beogradu", () => {
  assert.equal(key(parseCalendarDay("2026-03-14T23:00:00.000Z")), "2026-03-15"); // CET
  assert.equal(key(parseCalendarDay("2026-06-09T22:00:00.000Z")), "2026-06-10"); // CEST
  assert.equal(key(parseCalendarDay(new Date("2026-06-09T22:00:00.000Z"))), "2026-06-10");
});

test("calendarDayInZone: 'danas' je dan u Beogradu, ne u UTC", () => {
  assert.equal(key(calendarDayInZone(new Date("2026-11-05T23:30:00Z"))), "2026-11-06");
  assert.equal(key(calendarDayInZone(new Date("2026-07-05T21:59:00Z"))), "2026-07-05");
  assert.equal(key(calendarDayInZone(new Date("2026-07-05T22:00:00Z"))), "2026-07-06");
});

test("normalizeStoredDay: svi stari formati u bazi daju ispravan dan", () => {
  assert.equal(key(normalizeStoredDay("2026-06-09T22:00:00.000Z")), "2026-06-10");
  assert.equal(key(normalizeStoredDay("2026-03-14T23:00:00.000Z")), "2026-03-15");
  assert.equal(key(normalizeStoredDay("2026-11-06T22:00:00.000Z")), "2026-11-07"); // DST pomeraj
  assert.equal(key(normalizeStoredDay("2026-03-15T00:00:00.000Z")), "2026-03-15");
  assert.equal(normalizeStoredDay(null), null);
});

test("sameDayQuery pogađa i staru lokalnu ponoć", () => {
  const q = sameDayQuery(day("2026-06-10"));
  const legacy = new Date("2026-06-09T22:00:00.000Z");
  assert.ok(legacy >= q.$gte && legacy < q.$lt);
  assert.ok(!(day("2026-06-11") < q.$lt));
});

test("addYears: 29.02. + 1 godina = 28.02.", () => {
  assert.equal(key(addYears(day("2028-02-29"), 1)), "2029-02-28");
  assert.equal(key(addYears(day("2028-02-29"), 4)), "2032-02-29");
  assert.equal(key(addYears(day("2026-11-05"), 10)), "2036-11-05");
});

test("nextPeriodAfter: 30 dana i preko prolećnog DST prelaza", () => {
  const { startDate, endDate } = nextPeriodAfter(day("2027-03-27"));
  assert.equal(key(startDate), "2027-03-28");
  assert.equal(key(endDate), "2027-04-26");
});

test("periodi kroz februar prestupne i neprestupne godine", () => {
  // 2028 je prestupna: 01.02. + 29 dana = 01.03.
  assert.equal(key(nextPeriodAfter(day("2028-01-31")).endDate), "2028-03-01");
  // 2027 nije: 01.02. + 29 dana = 02.03.
  assert.equal(key(nextPeriodAfter(day("2027-01-31")).endDate), "2027-03-02");
  // 2100 nije prestupna (deljiva sa 100, ne sa 400)
  assert.equal(key(nextPeriodAfter(day("2100-01-31")).endDate), "2100-03-02");
});

test("periodIndexForDay: dan pre prijema daje prvi period", () => {
  assert.equal(periodIndexForDay(day("2026-06-10"), day("2026-06-01")), 0);
  assert.equal(periodIndexForDay(day("2026-06-10"), day("2026-07-09")), 0);
  assert.equal(periodIndexForDay(day("2026-06-10"), day("2026-07-10")), 1);
});

test("raspored: prijem leti (stari format) ne klizi posle DST-a, 10+ godina", () => {
  const admission = "2026-06-09T22:00:00.000Z"; // 10.06.2026 u Beogradu
  const until = addYears(day("2026-06-10"), 10);
  const periods = buildSpecificationSchedule(admission, until, day("2026-11-05"));

  assert.deepEqual(
    periods.slice(0, 6).map((p) => key(p.startDate)),
    ["2026-06-10", "2026-07-10", "2026-08-09", "2026-09-08", "2026-10-08", "2026-11-07"]
  );

  periods.forEach((p, i) => {
    assert.equal(diffInDays(p.startDate, p.endDate), 29, `period ${p.index} nema 30 dana`);
    assert.equal(p.startDate.getUTCHours(), 0);
    if (i > 0) assert.equal(diffInDays(periods[i - 1].endDate, p.startDate), 1, `rupa pre perioda ${p.index}`);
  });

  // Za 10 godina (3652 dana, uklj. 2028. i 2032.) ima tačno ceil(3653/30) perioda
  const totalDays = diffInDays(day("2026-06-10"), until) + 1;
  assert.equal(periods.length, Math.ceil(totalDays / 30));
  assert.ok(periods[periods.length - 1]!.startDate <= until);
});

test("raspored: označava prošle i trenutni period", () => {
  const periods = buildSpecificationSchedule(day("2026-06-10"), day("2027-06-10"), day("2026-11-05"));
  const current = periods.filter((p) => p.isCurrent);
  assert.equal(current.length, 1);
  assert.equal(key(current[0].startDate), "2026-10-08");
  assert.equal(periods.filter((p) => p.isPast).length, 4);
});

test("horizont: 10 godina od danas i za davno primljene pacijente", () => {
  assert.equal(key(futureScheduleHorizon(day("2018-01-01"), day("2026-11-05"))), "2036-11-05");
  assert.equal(key(futureScheduleHorizon(day("2027-01-01"), day("2026-11-05"))), "2037-01-01");
});
