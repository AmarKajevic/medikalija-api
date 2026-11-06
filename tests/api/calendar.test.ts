// Kalendar: unos po satima, celodnevni i stari zapisi, ponavljanje po zidnom satu
// doma (i preko prelaska na letnje vreme), izuzeci iz niza i prava pristupa.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import CalendarEvent from "../../models/CalendarEvent.js";
import { authHeader, createPatient, createUser, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
});

type Occ = { id: string; eventId: string; title: string; start: string; end: string; allDay: boolean; occurrenceStart: string; recurring: boolean };

const create = (body: object, user: UserDoc = admin) => request(app).post("/api/calendar").set(authHeader(user)).send(body);
const list = async (from: string, to: string, extra = ""): Promise<Occ[]> => {
  const res = await request(app).get(`/api/calendar?from=${from}&to=${to}${extra}`).set(authHeader(nurse));
  assert.equal(res.status, 200, res.body.message);
  return res.body.events;
};

describe("osnovno", () => {
  test("događaj po satima: tačno vreme, i samo u traženom opsegu", async () => {
    const res = await create({ title: "Pregled kardiologa", allDay: false, start: "2026-11-10T09:30:00.000Z", end: "2026-11-10T10:30:00.000Z", calendar: "plava" });
    assert.equal(res.status, 201, res.body.message);

    const week = await list("2026-11-09T00:00:00Z", "2026-11-16T00:00:00Z");
    assert.equal(week.length, 1);
    assert.equal(week[0]!.start, "2026-11-10T09:30:00.000Z");
    assert.equal(week[0]!.allDay, false);
    assert.equal((await list("2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z")).length, 0);
  });

  test("celodnevni: kraj je uključiv, a događaj koji traje vidi se i usred trajanja", async () => {
    await create({ title: "Renoviranje kupatila", allDay: true, start: "2026-11-02", end: "2026-11-05" });
    const mid = await list("2026-11-04T00:00:00Z", "2026-11-05T00:00:00Z");
    assert.equal(mid.length, 1);
    assert.deepEqual([mid[0]!.start, mid[0]!.end], ["2026-11-02", "2026-11-05"]);
    assert.equal((await list("2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z")).length, 0);
  });

  test("stari zapis (bez allDay, lokalna ponoć, ekskluzivan kraj) prikazuje se kao pre", async () => {
    // FullCalendar je slao "2026-06-10" do "2026-06-12" (ekskluzivno) → 10. i 11. jun
    await CalendarEvent.collection.insertOne({
      title: "Stari događaj",
      start: new Date("2026-06-09T22:00:00Z"),
      end: new Date("2026-06-11T22:00:00Z"),
      calendar: "Primary",
      userId: admin._id,
    });
    const [e] = await list("2026-06-01T00:00:00Z", "2026-06-30T00:00:00Z");
    assert.equal(e!.allDay, true);
    assert.deepEqual([e!.start, e!.end], ["2026-06-10", "2026-06-11"]);
    assert.equal((e as unknown as { calendar: string }).calendar, "plava", "stari ključ boje se mapira");
  });

  test("provera unosa", async () => {
    const base = { title: "X", allDay: false, start: "2026-11-10T09:00:00Z", end: "2026-11-10T10:00:00Z" };
    assert.equal((await create({ ...base, title: "  " })).status, 400);
    assert.equal((await create({ ...base, end: "2026-11-10T08:00:00Z" })).status, 400, "kraj pre početka");
    assert.equal((await create({ ...base, calendar: "ljubičasta" })).status, 400);
    assert.equal((await create({ ...base, allDay: true })).status, 400, "celodnevni traži datume");
    assert.equal((await create({ ...base, patientId: "64b000000000000000000000" })).status, 400);
    assert.equal((await create({ ...base, recurrence: { freq: "weekly", until: "2026-01-01" } })).status, 400);
    assert.equal((await create({ ...base, recurrence: { freq: "daily", until: "2026-12-01", count: 3 } })).status, 400);
  });

  test("sestra vidi kalendar, ali ne može da ga menja", async () => {
    const res = await create({ title: "X", allDay: true, start: "2026-11-10", end: "2026-11-10" }, nurse);
    assert.equal(res.status, 403);
    const { body } = await create({ title: "Y", allDay: true, start: "2026-11-10", end: "2026-11-10" });
    assert.equal((await request(app).delete(`/api/calendar/${body.event._id}`).set(authHeader(nurse))).status, 403);
    assert.equal((await request(app).get("/api/calendar").set(authHeader(nurse))).status, 200);
  });

  test("filter po pacijentu", async () => {
    const patient = await createPatient();
    await create({ title: "Pregled", allDay: true, start: "2026-11-10", end: "2026-11-10", patientId: String(patient._id) });
    await create({ title: "Sastanak", allDay: true, start: "2026-11-10", end: "2026-11-10" });
    const events = await list("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z", `&patientId=${patient._id}`);
    assert.deepEqual(events.map((e) => e.title), ["Pregled"]);
  });
});

describe("ponavljanje", () => {
  test("svakog utorka u 10:00 po beogradskom vremenu, i posle prelaska na letnje vreme", async () => {
    // 17.03.2026 10:00 CET = 09:00Z; letnje vreme počinje 29.03.
    await create({
      title: "Fizioterapija",
      allDay: false,
      start: "2026-03-17T09:00:00Z",
      end: "2026-03-17T10:00:00Z",
      recurrence: { freq: "weekly", byWeekday: [1] },
    });
    const events = await list("2026-03-16T00:00:00Z", "2026-04-08T00:00:00Z");
    assert.deepEqual(
      events.map((e) => e.start),
      ["2026-03-17T09:00:00.000Z", "2026-03-24T09:00:00.000Z", "2026-03-31T08:00:00.000Z", "2026-04-07T08:00:00.000Z"]
    );
    assert.equal(new Set(events.map((e) => e.id)).size, 4, "svaki termin ima svoj id");
  });

  test("više dana u nedelji, svake druge nedelje, sa brojem ponavljanja", async () => {
    // Ponedeljak 02.11.2026: pon + sre, svake 2. nedelje, ukupno 5 termina
    await create({ title: "Kupanje", allDay: true, start: "2026-11-02", end: "2026-11-02", recurrence: { freq: "weekly", interval: 2, byWeekday: [0, 2], count: 5 } });
    const events = await list("2026-11-01T00:00:00Z", "2027-01-31T00:00:00Z");
    assert.deepEqual(events.map((e) => e.start), ["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18", "2026-11-30"]);
  });

  test("mesečno 31.: meseci bez 31. dana se preskaču; kraj ponavljanja se poštuje", async () => {
    await create({ title: "Obračun", allDay: true, start: "2026-01-31", end: "2026-01-31", recurrence: { freq: "monthly", until: "2026-08-31" } });
    const events = await list("2026-01-01T00:00:00Z", "2026-12-31T00:00:00Z");
    assert.deepEqual(events.map((e) => e.start), ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2026-08-31"]);
  });

  test("brisanje i izmena samo jednog termina", async () => {
    const { body } = await create({ title: "Vizita", allDay: false, start: "2026-11-02T08:00:00Z", end: "2026-11-02T09:00:00Z", recurrence: { freq: "daily", count: 4 } });
    const id = body.event._id;
    const [, second, third] = await list("2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z");

    const del = await request(app).delete(`/api/calendar/${id}?occurrence=${second!.occurrenceStart}`).set(authHeader(admin));
    assert.equal(del.status, 200);

    const moved = await request(app)
      .put(`/api/calendar/${id}`)
      .set(authHeader(admin))
      .send({ scope: "occurrence", occurrenceStart: third!.occurrenceStart, title: "Vizita (pomereno)", allDay: false, start: "2026-11-04T12:00:00Z", end: "2026-11-04T13:00:00Z" });
    assert.equal(moved.status, 200, moved.body.message);

    const after = await list("2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z");
    assert.deepEqual(
      after.map((e) => [e.title, e.start]),
      [
        ["Vizita", "2026-11-02T08:00:00.000Z"],
        ["Vizita (pomereno)", "2026-11-04T12:00:00.000Z"],
        ["Vizita", "2026-11-05T08:00:00.000Z"],
      ]
    );

    const bad = await request(app).delete(`/api/calendar/${id}?occurrence=2026-11-02T08:30:00.000Z`).set(authHeader(admin));
    assert.equal(bad.status, 400, "nepostojeći termin");

    await request(app).delete(`/api/calendar/${id}`).set(authHeader(admin));
    assert.equal(await CalendarEvent.countDocuments(), 0, "brisanje niza briše i izmenjene termine");
  });
});

describe("kontrolna tabla", () => {
  test("narednih 7 dana uključuje i događaj koji je već počeo", async () => {
    const now = Date.now();
    await create({ title: "Traje", allDay: false, start: new Date(now - 3_600_000).toISOString(), end: new Date(now + 3_600_000).toISOString() });
    await create({ title: "Prošao", allDay: false, start: new Date(now - 7_200_000).toISOString(), end: new Date(now - 3_600_000).toISOString() });
    const res = await request(app).get("/api/dashboard/stats").set(authHeader(admin));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.stats.upcomingEvents.map((e: { title: string }) => e.title), ["Traje"]);
  });
});
