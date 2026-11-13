// Napomena na specifikaciji, cenovnik drugih troškova i brisanje duplikata pacijenata.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Patient from "../../models/Patient.js";
import Specification from "../../models/Specification.js";
import { patientNameKey } from "../../services/patientIdentity.js";
import { authHeader, createPatient, createUser, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let mainNurse: UserDoc;
let nurse: UserDoc;
beforeEach(async () => {
  admin = await createUser("admin");
  mainNurse = await createUser("main-nurse");
  nurse = await createUser("nurse");
});

const as = (user: UserDoc) => ({
  get: (url: string) => request(app).get(url).set(authHeader(user)),
  post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(user)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(authHeader(user)).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(authHeader(user)).send(body),
  del: (url: string) => request(app).delete(url).set(authHeader(user)),
});

describe("napomena na specifikaciji", () => {
  test("uprava čuva i briše napomenu; sestra ne može", async () => {
    const patient = await createPatient();
    const spec = await Specification.create({ patientId: patient._id, startDate: new Date(), endDate: new Date(), items: [] });
    const saved = await as(mainNurse).patch(`/api/specification/${spec._id}/note`, { note: "  Plaćeno delimično  " });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.specification.note, "Plaćeno delimično");
    assert.equal((await as(nurse).patch(`/api/specification/${spec._id}/note`, { note: "x" })).status, 403);
    assert.equal((await as(admin).patch(`/api/specification/${spec._id}/note`, { note: "a".repeat(2001) })).status, 400);
    const cleared = await as(admin).patch(`/api/specification/${spec._id}/note`, { note: "" });
    assert.equal(cleared.body.specification.note, "");
  });
});

describe("cenovnik drugih troškova", () => {
  test("admin pravi cenovnik; uprava čita; sestra nema pristup", async () => {
    const a = as(admin);
    const created = await a.post("/api/extra-costs", { name: "Frizer", priceRSD: 800 });
    assert.equal(created.status, 201);
    assert.equal((await a.post("/api/extra-costs", { name: "FRIZER", priceRSD: 1 })).status, 409);
    assert.equal((await a.post("/api/extra-costs", { name: "Bez cene" })).status, 400);
    assert.equal((await as(mainNurse).post("/api/extra-costs", { name: "Prevoz", priceRSD: 1 })).status, 403);
    assert.equal((await as(nurse).get("/api/extra-costs")).status, 403);

    const id = created.body.cost._id;
    assert.equal((await a.put(`/api/extra-costs/${id}`, { priceRSD: 900, active: false })).body.cost.priceRSD, 900);
    assert.equal((await as(mainNurse).get("/api/extra-costs")).body.costs.length, 0, "neaktivni se ne nude");
    assert.equal((await a.get("/api/extra-costs?all=1")).body.costs.length, 1);
    assert.equal((await a.del(`/api/extra-costs/${id}`)).status, 200);
  });
});

describe("duplikati pacijenata", () => {
  test("ostaje pacijent sa dokumentacijom; brišu se samo prazni duplikati", async () => {
    const withData = await createPatient({ name: "Marko", lastName: "Marković" });
    const emptyDup = await createPatient({ name: " marko", lastName: "MARKOVIĆ " });
    const emptyDup2 = await createPatient({ name: "Marko", lastName: "Marković" });
    const unique = await createPatient({ name: "Jovan", lastName: "Jovanović" });
    // Oba prazna: ostaje najstariji
    const oldA = await createPatient({ name: "Ana", lastName: "Anić" });
    const newA = await createPatient({ name: "Ana", lastName: "Anić" });
    await Specification.create({ patientId: withData._id, startDate: new Date(), endDate: new Date(), items: [{ name: "Lek", price: 100, amount: 1 }] });
    await Specification.create({ patientId: emptyDup._id, startDate: new Date(), endDate: new Date(), items: [] });

    assert.equal((await as(nurse).get("/api/patient/duplicates")).status, 403);
    const plan = (await as(admin).get("/api/patient/duplicates")).body;
    assert.equal(plan.removeCount, 3);
    assert.equal(plan.groups.length, 2);
    const marko = plan.groups.find((g: { keep: { _id: string } }) => g.keep._id === String(withData._id));
    assert.ok(marko, "ostaje pacijent sa specifikacijom");
    assert.deepEqual([...marko.remove].sort(), [String(emptyDup._id), String(emptyDup2._id)].sort());

    const res = await as(admin).post("/api/patient/duplicates/remove");
    assert.equal(res.status, 200);
    assert.equal(res.body.removed, 3);
    const left = (await Patient.find().lean()).map((p) => String(p._id)).sort();
    assert.deepEqual(left, [String(withData._id), String(unique._id), String(oldA._id)].sort());
    assert.equal(await Specification.countDocuments({ patientId: emptyDup._id }), 0, "prazni periodi duplikata su obrisani");
    assert.ok(!left.includes(String(newA._id)));
  });

  test("duplikat sa dokumentacijom se ne briše", async () => {
    const a = await createPatient({ name: "Mila", lastName: "Milić" });
    const b = await createPatient({ name: "Mila", lastName: "Milić" });
    await Specification.create({ patientId: a._id, startDate: new Date(), endDate: new Date(), items: [{ name: "Lek", price: 1, amount: 1 }] });
    await Specification.create({ patientId: b._id, startDate: new Date(), endDate: new Date(), items: [{ name: "Lek", price: 1, amount: 1 }] });
    const res = await as(admin).post("/api/patient/duplicates/remove");
    assert.equal(res.body.removed, 0);
    assert.equal(res.body.skipped, 1);
    assert.equal(await Patient.countDocuments(), 2);
  });
});

describe("isto ime u ćirilici i latinici", () => {
  test("ključ imena ne zavisi od pisma, kvačica i velikih slova", () => {
    const k = patientNameKey("Đorđe", "Petrović");
    assert.equal(patientNameKey("Ђорђе", "Петровић"), k);
    assert.equal(patientNameKey("DJORDJE", "petrovic"), k);
    assert.equal(patientNameKey(" Љиљана ", "Њего"), patientNameKey("Ljiljana", "Njego"));
    assert.notEqual(patientNameKey("Marko", "Petrović"), k);
  });

  test("duplikat u ćirilici se briše, ostaje latinični sa podacima", async () => {
    const lat = await createPatient({ name: "Milica", lastName: "Jovanović" });
    const cyr = await createPatient({ name: "Милица", lastName: "Јовановић" });
    await Specification.create({ patientId: lat._id, startDate: new Date(), endDate: new Date(), items: [{ name: "Lek", price: 1, amount: 1 }] });
    const res = await as(admin).post("/api/patient/duplicates/remove");
    assert.equal(res.body.removed, 1);
    assert.equal(await Patient.countDocuments({ _id: cyr._id }), 0);
    assert.equal(await Patient.countDocuments({ _id: lat._id }), 1);
  });

  test("ne može se dodati korisnik sa istim imenom i prezimenom (ni u drugom pismu)", async () => {
    const existing = await createPatient({ name: "Milica", lastName: "Jovanović" });
    const body = { lastName: "Јовановић", name: "Милица", admissionDate: "2026-10-01" };
    const blocked = await as(admin).post("/api/patient/addPatient", body);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.message, /već postoji/);
    const social = await as(admin).post("/api/social/residents", { patient: { name: "MILICA", lastName: "Jovanovic", admissionDate: "2026-10-01" } });
    assert.equal(social.status, 409);
    assert.equal(await Patient.countDocuments(), 1);

    // Preimenovanje u postojeće ime nije dozvoljeno; izmena ostalih podataka jeste
    const other = await createPatient({ name: "Ana", lastName: "Anić" });
    assert.equal((await as(admin).put(`/api/patient/${other._id}`, { name: "Milica", lastName: "Jovanović" })).status, 409);
    assert.equal((await as(admin).put(`/api/patient/${existing._id}`, { name: "Milica", lastName: "Jovanović", address: "Novi Sad" })).status, 200);
  });
});

describe("socijalni radnik", () => {
  test("menja podatke, briše korisnika bez dokumentacije i duplikate; i trajno briše kao admin", async () => {
    const social = await createUser("social-worker");
    const s = as(social);
    const patient = await createPatient({ name: "Pera", lastName: "Perić" });
    const edited = await s.put(`/api/patient/${patient._id}`, { name: "Petar", address: "Niš" });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.patient.name, "Petar");
    assert.equal((await as(nurse).put(`/api/patient/${patient._id}`, { address: "x" })).status, 403);

    await createPatient({ name: "Петар", lastName: "Перић" });
    assert.equal((await s.post("/api/patient/duplicates/remove")).body.removed, 1);

    assert.equal((await s.del(`/api/patient/${patient._id}`)).status, 200);
    assert.equal(await Patient.countDocuments(), 0);

    // Trajno brisanje sa svim podacima, kao admin (bez kucanja imena); glavna sestra ne može
    const withData = await createPatient({ name: "Mara", lastName: "Marić" });
    await Specification.create({ patientId: withData._id, startDate: new Date(), endDate: new Date(), items: [{ name: "Lek", price: 1, amount: 1 }] });
    const purge = (u: UserDoc, confirmName: string) => request(app).delete(`/api/patient/${withData._id}?permanent=true`).set(authHeader(u)).send({ confirmName });
    assert.equal((await purge(mainNurse, "Mara Marić")).status, 403);
    assert.equal((await purge(social, "Mara Marić")).status, 200);
    assert.equal(await Specification.countDocuments({ patientId: withData._id }), 0);
    assert.equal((await as(nurse).del(`/api/patient/${(await createPatient())._id}`)).status, 403);
  });
});

describe("otpust", () => {
  test("socijalni radnik otpušta korisnika; sestra ne može", async () => {
    const social = await createUser("social-worker");
    const patient = await createPatient();
    const url = `/api/patient/${patient._id}/discharge`;
    const today = new Date().toISOString().slice(0, 10);
    assert.equal((await as(nurse).patch(url, { dischargeDate: today })).status, 403);
    const res = await as(social).patch(url, { dischargeDate: today });
    assert.equal(res.status, 200, res.body.message);
    assert.ok((await Patient.findById(patient._id))?.dischargeDate);
  });
});

describe("vanredna fizikalna terapija iz specifikacije", () => {
  test("uprava dodaje terapiju po ceni iz cenovnika; bez cene i sestra ne mogu", async () => {
    const patient = await createPatient();
    const spec = await Specification.create({ patientId: patient._id, startDate: new Date(), endDate: new Date(), items: [], isActive: true });
    const body = { patientId: String(patient._id), kind: "active", amount: 2, specificationId: String(spec._id) };
    assert.equal((await as(mainNurse).post("/api/physio-prices/charge", body)).status, 400, "cena nije uneta");
    await as(admin).put("/api/physio-prices/active", { priceRSD: 1000 });
    assert.equal((await as(nurse).post("/api/physio-prices/charge", body)).status, 403);
    const res = await as(mainNurse).post("/api/physio-prices/charge", body);
    assert.equal(res.status, 201, res.body.message);
    const item = res.body.specification.items[0];
    assert.equal(item.category, "physio");
    assert.equal(item.price, 2000);
    assert.equal(item.amount, 2);
    assert.match(item.name, /aktivna.*\(vanredna\)/);
    assert.equal(res.body.specification.totalPrice, 2000);
    assert.equal((await as(mainNurse).post("/api/physio-prices/charge", { ...body, kind: "x" })).status, 400);
  });
});

describe("nove vrste fizikalne terapije", () => {
  test("admin dodaje, menja i briše vrstu; ona se nudi, naplaćuje i unosi kao osnovne", async () => {
    const created = await as(admin).post("/api/physio-prices", { name: "Limfna drenaža", priceRSD: 1500 });
    assert.equal(created.status, 201);
    const kind = created.body.price.kind;
    assert.equal((await as(admin).post("/api/physio-prices", { name: "limfna drenaža", priceRSD: 1 })).status, 409);
    assert.equal((await as(admin).post("/api/physio-prices", { name: "Individualna aktivna fizikalna terapija", priceRSD: 1 })).status, 409);
    assert.equal((await as(mainNurse).post("/api/physio-prices", { name: "X", priceRSD: 1 })).status, 403);

    const list = (await as(mainNurse).get("/api/physio-prices")).body.prices;
    assert.equal(list.length, 4);
    assert.deepEqual(list[3], { kind, name: "Limfna drenaža", priceRSD: 1500, custom: true });

    const physio = await createUser("physiotherapist");
    const kinds = (await as(physio).get("/api/physio-prices/kinds")).body.kinds;
    assert.ok(kinds.some((k: { name: string }) => k.name === "Limfna drenaža"));
    assert.equal((await as(physio).get("/api/physio-prices")).status, 403, "fizioterapeut ne vidi cene");

    // Unos fizioterapeuta i naplata iz specifikacije
    const patient = await createPatient();
    const entry = await as(physio).post("/api/nurse-entries", { patientId: String(patient._id), entries: [{ type: "physio", physioKind: kind, extra: true }] });
    assert.equal(entry.status, 201, entry.body.message);
    const spec = await Specification.create({ patientId: patient._id, startDate: new Date(), endDate: new Date(), items: [], isActive: true });
    const charged = await as(mainNurse).post("/api/physio-prices/charge", { patientId: String(patient._id), kind, specificationId: String(spec._id) });
    assert.equal(charged.status, 201, charged.body.message);
    assert.equal(charged.body.specification.items[0].name, "Limfna drenaža (vanredna)");
    assert.equal(charged.body.specification.items[0].price, 1500);

    assert.equal((await as(admin).put(`/api/physio-prices/${kind}`, { name: "Limfna drenaža — 30 min", priceRSD: 1600 })).status, 200);
    assert.equal((await as(admin).del(`/api/physio-prices/${kind}`)).status, 200);
    assert.equal((await as(mainNurse).get("/api/physio-prices")).body.prices.length, 3);

    // Osnovne vrste se takođe menjaju i brišu
    assert.equal((await as(admin).put("/api/physio-prices/group", { name: "Grupne vežbe", priceRSD: 700 })).status, 200);
    assert.ok((await as(mainNurse).get("/api/physio-prices")).body.prices.some((p: { kind: string; name: string }) => p.kind === "group" && p.name === "Grupne vežbe"));
    assert.equal((await as(admin).del("/api/physio-prices/passive")).status, 200);
    const left = (await as(mainNurse).get("/api/physio-prices")).body.prices.map((p: { kind: string }) => p.kind);
    assert.deepEqual(left, ["active", "group"]);
    assert.equal((await as(mainNurse).post("/api/physio-prices/charge", { patientId: String(patient._id), kind: "passive" })).status, 400, "obrisana se ne naplaćuje");
    assert.equal((await as(admin).del("/api/physio-prices/passive")).status, 404);
  });
});
