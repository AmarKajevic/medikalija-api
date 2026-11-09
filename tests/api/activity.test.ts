// Aktivnosti: šta je ko od osoblja dodao (unosi sestara, fizioterapija, učinak, direktni unosi uprave).
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import Diagnosis from "../../models/Diagnosis.js";
import { authHeader, createPatient, createUser, DAY_MS, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;
let physio: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
  physio = await createUser("physiotherapist");
  patient = await createPatient();
});

const post = (user: UserDoc, entries: object[]) =>
  request(app).post("/api/nurse-entries").set(authHeader(user)).send({ patientId: String(patient._id), entries });
const activity = (q = "", user: UserDoc = admin) => request(app).get(`/api/activity${q}`).set(authHeader(user));

describe("aktivnosti osoblja", () => {
  test("prikazuje sve što je osoblje dodalo, sa statusom; prihvaćen unos se ne ponavlja", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const nurseRes = await post(nurse, [{ type: "medicine", itemId: String(med._id), amount: 2, note: "posle ručka" }]);
    await request(app).post(`/api/nurse-entries/${nurseRes.body.entries[0]._id}/accept`).set(authHeader(admin)).expect(200);
    await post(physio, [
      { type: "physio", physioKind: "active" },
      { type: "physio", physioKind: "group", extra: true },
    ]).expect(201);
    await Diagnosis.create({ patient: patient._id, description: "Pritisak 130/80", createdBy: nurse._id });
    await post(admin, [{ type: "medicine", itemId: String(med._id), amount: 1 }]).expect(201);

    const res = await activity();
    assert.equal(res.status, 200, res.body.message);
    const rows = res.body.activity as Array<{ kind: string; status: string; title: string; detail: string; by: { role: string }; patient: { name: string } }>;
    const summary = rows.map((r) => `${r.by.role}:${r.kind}:${r.status}`).sort();
    assert.deepEqual(summary, [
      "admin:medicine:accepted", // uprava: unos se odmah primenjuje
      "nurse:medicine:accepted",
      "nurse:note:note",
      "physiotherapist:physio:logged", // redovna: samo zabeležena
      "physiotherapist:physio:pending", // vanredna: čeka odobrenje
    ]);
    const nurseRow = rows.find((r) => r.by.role === "nurse" && r.kind === "medicine")!;
    assert.equal(nurseRow.title, "Andol × 2");
    assert.equal(nurseRow.detail, "posle ručka");
    assert.equal(nurseRow.patient.name, "Petar");
  });

  test("filtrira po osobi i periodu", async () => {
    await Diagnosis.create({ patient: patient._id, description: "Danas", createdBy: nurse._id });
    await Diagnosis.create({ patient: patient._id, description: "Fizio", createdBy: physio._id });
    const old = await Diagnosis.create({ patient: patient._id, description: "Staro", createdBy: nurse._id });
    await Diagnosis.collection.updateOne({ _id: old._id }, { $set: { createdAt: new Date(Date.now() - 40 * DAY_MS) } });

    const mine = await activity(`?userId=${nurse._id}`);
    assert.deepEqual(mine.body.activity.map((r: { detail: string }) => r.detail), ["Danas"]); // podrazumevano poslednjih 30 dana

    const from = new Date(Date.now() - 60 * DAY_MS).toISOString();
    const all = await activity(`?userId=${nurse._id}&from=${from}`);
    assert.deepEqual(all.body.activity.map((r: { detail: string }) => r.detail), ["Danas", "Staro"]);
  });

  test("samo uprava; neispravni parametri", async () => {
    assert.equal((await activity("", nurse)).status, 403);
    assert.equal((await activity("", physio)).status, 403);
    assert.equal((await activity("?userId=x")).status, 400);
    assert.equal((await activity(`?from=${new Date().toISOString()}&to=${new Date(Date.now() - DAY_MS).toISOString()}`)).status, 400);
  });
});
