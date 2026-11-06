// Doktor i socijalni radnik: šta ko sme da vidi i menja.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import { authHeader, createPatient, createUser, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;
let doctor: UserDoc;
let doctor2: UserDoc;
let social: UserDoc;
let social2: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
  doctor = await createUser("doctor");
  doctor2 = await createUser("doctor");
  social = await createUser("social-worker");
  social2 = await createUser("social-worker");
  patient = await createPatient({ name: "Milica", lastName: "Jovanović" });
});

const as = (user: UserDoc) => ({
  get: (url: string) => request(app).get(url).set(authHeader(user)),
  post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(user)).send(body),
  put: (url: string, body: object = {}) => request(app).put(url).set(authHeader(user)).send(body),
  del: (url: string) => request(app).delete(url).set(authHeader(user)),
});

describe("socijalni radnik: samo ono što mu treba", () => {
  test("vidi pacijente, ne vidi specifikacije, lekove ni medicinske podatke", async () => {
    const sw = as(social);
    assert.equal((await sw.get("/api/patient")).status, 200);
    assert.equal((await sw.get(`/api/patient/${patient._id}`)).status, 200);
    for (const url of [`/api/specification/${patient._id}`, "/api/medicine", "/api/articles", `/api/diagnosis/${patient._id}`, "/api/medical-reports", `/api/nurse-entries?patientId=${patient._id}`, "/api/exchange-rates"]) {
      assert.equal((await sw.get(url)).status, 403, url);
    }
    assert.equal((await sw.post("/api/patient/addPatient", { name: "X" })).status, 403);
  });

  test("pretraga mu vraća samo pacijente", async () => {
    await Medicine.create({ name: "Milgamma", quantity: 1 });
    const res = await as(social).get("/api/search?q=mil");
    assert.deepEqual(res.body.results.map((r: { type: string }) => r.type), ["patient"]);
  });

  test("prijava radi (uloga ima pristup aplikaciji)", async () => {
    assert.equal(social.loginAllowed, true);
  });
});

describe("socijalni karton", () => {
  const note = { category: "family", text: "Razgovor sa sinom o poseti.", contact: "sin Marko", followUp: { date: "2026-12-01" } };

  test("piše socijalni radnik, čita i doktor, sestra nema pristup", async () => {
    const created = await as(social).post("/api/social-notes", { ...note, patientId: String(patient._id) });
    assert.equal(created.status, 201, created.body.message);
    assert.equal(created.body.note.contact, "sin Marko");

    assert.equal((await as(doctor).get(`/api/social-notes?patientId=${patient._id}`)).body.notes.length, 1);
    assert.equal((await as(doctor).post("/api/social-notes", { ...note, patientId: String(patient._id) })).status, 403);
    assert.equal((await as(nurse).get(`/api/social-notes?patientId=${patient._id}`)).status, 403);
  });

  test("menja autor ili uprava; podsetnik se zatvara", async () => {
    const { body } = await as(social).post("/api/social-notes", { ...note, patientId: String(patient._id) });
    const id = body.note._id;
    assert.equal((await as(social2).put(`/api/social-notes/${id}`, { ...note, text: "tuđe" })).status, 403);
    assert.equal((await as(admin).put(`/api/social-notes/${id}`, { ...note, text: "ispravka uprave" })).status, 200);

    assert.equal((await as(social).get("/api/social-notes?followUp=open")).body.notes.length, 1);
    const done = await as(social).post(`/api/social-notes/${id}/follow-up`, { done: true });
    assert.equal(done.body.note.followUp.done, true);
    assert.equal((await as(social).get("/api/social-notes?followUp=open")).body.notes.length, 0);
  });

  test("provera unosa", async () => {
    const base = { ...note, patientId: String(patient._id) };
    assert.equal((await as(social).post("/api/social-notes", { ...base, text: " " })).status, 400);
    assert.equal((await as(social).post("/api/social-notes", { ...base, category: "x" })).status, 400);
    assert.equal((await as(social).post("/api/social-notes", { ...base, patientId: "64b000000000000000000000" })).status, 400);
  });
});

describe("lekarski izveštaji", () => {
  const report = {
    type: "exam",
    visitDate: "2026-11-05T09:00:00Z",
    vitals: { bloodPressure: "135 / 85", pulse: "78", temperature: "36,6" },
    anamnesis: "Žali se na vrtoglavicu.",
    findings: "Uredan nalaz na srcu i plućima.",
    diagnoses: [{ code: "i10", name: "Esencijalna hipertenzija" }],
    therapy: "Concor 5mg 1x1",
  };
  const create = (user: UserDoc = doctor, body: object = report) => as(user).post("/api/medical-reports", { ...body, patientId: String(patient._id) });

  test("nacrt vidi samo autor; potpisan vidi zdravstveno osoblje", async () => {
    const { body, status } = await create();
    assert.equal(status, 201, body.message);
    assert.equal(body.report.vitals.bloodPressure, "135/85");
    assert.equal(body.report.vitals.temperature, 36.6);
    assert.equal(body.report.diagnoses[0].code, "I10");
    const id = body.report._id;

    assert.equal((await as(nurse).get(`/api/medical-reports?patientId=${patient._id}`)).body.reports.length, 0);
    assert.equal((await as(doctor2).get(`/api/medical-reports/${id}`)).status, 404);

    const signed = await as(doctor).post(`/api/medical-reports/${id}/sign`);
    assert.equal(signed.status, 200);
    assert.equal(signed.body.report.status, "signed");
    assert.equal((await as(nurse).get(`/api/medical-reports?patientId=${patient._id}`)).body.reports.length, 1);
    assert.equal((await as(social).get(`/api/medical-reports/${id}`)).status, 403);
  });

  test("potpisan se ne menja; ispravka ide kao dopuna", async () => {
    const { body } = await create();
    const id = body.report._id;
    await as(doctor).post(`/api/medical-reports/${id}/sign`);
    assert.equal((await as(doctor).put(`/api/medical-reports/${id}`, report)).status, 409);
    assert.equal((await as(doctor).del(`/api/medical-reports/${id}`)).status, 409);

    const add = await as(doctor2).post(`/api/medical-reports/${id}/addenda`, { text: "Kontrola pritiska za 7 dana." });
    assert.equal(add.status, 201);
    assert.equal(add.body.report.addenda[0].text, "Kontrola pritiska za 7 dana.");
    assert.equal(add.body.report.addenda[0].author.name, doctor2.name);
  });

  test("samo autor menja nacrt; samo doktor piše", async () => {
    const { body } = await create();
    const id = body.report._id;
    assert.equal((await as(doctor2).put(`/api/medical-reports/${id}`, report)).status, 403);
    assert.equal((await create(nurse)).status, 403);
    assert.equal((await create(admin)).status, 403);
    assert.equal((await as(doctor).del(`/api/medical-reports/${id}`)).status, 200);
  });

  test("provera unosa i potpisa", async () => {
    assert.equal((await create(doctor, { ...report, diagnoses: [{ code: "HTN", name: "x" }] })).status, 400, "MKB-10 oblik");
    assert.equal((await create(doctor, { ...report, vitals: { bloodPressure: "visok" } })).status, 400);
    assert.equal((await create(doctor, { ...report, vitals: { temperature: 50 } })).status, 400);
    assert.equal((await create(doctor, { ...report, visitDate: "2030-01-01T00:00:00Z" })).status, 400);
    const empty = await create(doctor, { type: "exam", visitDate: "2026-11-05T09:00:00Z" });
    assert.equal((await as(doctor).post(`/api/medical-reports/${empty.body.report._id}/sign`)).status, 400, "prazan izveštaj se ne potpisuje");
  });
});

describe("zakazivanje", () => {
  const event = { title: "Pregled", allDay: false, start: "2026-11-10T09:00:00Z", end: "2026-11-10T09:30:00Z" };

  test("doktor i socijalni radnik zakazuju; sestra ne", async () => {
    assert.equal((await as(doctor).post("/api/calendar", event)).status, 201);
    assert.equal((await as(social).post("/api/calendar", { ...event, title: "Poseta porodice" })).status, 201);
    assert.equal((await as(nurse).post("/api/calendar", event)).status, 403);
  });

  test("doktor menja svoje termine, tuđe ne; uprava menja sve", async () => {
    const mine = (await as(doctor).post("/api/calendar", event)).body.event._id;
    const adminEvent = (await as(admin).post("/api/calendar", event)).body.event._id;
    assert.equal((await as(doctor).put(`/api/calendar/${mine}`, { ...event, title: "Kontrola" })).status, 200);
    assert.equal((await as(doctor).put(`/api/calendar/${adminEvent}`, event)).status, 403);
    assert.equal((await as(doctor2).del(`/api/calendar/${mine}`)).status, 403);
    assert.equal((await as(admin).del(`/api/calendar/${mine}`)).status, 200);
  });
});
