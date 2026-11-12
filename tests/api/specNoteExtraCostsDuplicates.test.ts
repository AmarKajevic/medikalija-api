// Napomena na specifikaciji, cenovnik drugih troškova i brisanje duplikata pacijenata.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Patient from "../../models/Patient.js";
import Specification from "../../models/Specification.js";
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

    assert.equal((await as(mainNurse).get("/api/patient/duplicates")).status, 403);
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
