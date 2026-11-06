// Unosi sestara i odobravanje: šta ulazi u specifikaciju, šta se skida sa stanja,
// i da se ništa ne naplati dvaput.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import Article from "../../models/Articles.js";
import PatientArticle from "../../models/PatientArticle.js";
import CareTask from "../../models/CareTask.js";
import NurseEntry from "../../models/NurseEntry.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let mainNurse: UserDoc;
let nurse: UserDoc;
let otherNurse: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  admin = await createUser("admin");
  mainNurse = await createUser("main-nurse");
  nurse = await createUser("nurse");
  otherNurse = await createUser("nurse");
  patient = await createPatient();
});

const pid = () => String(patient._id);
const spec = async () => (await request(app).get(`/api/specification/${pid()}`).set(authHeader(admin))).body.specification;
const submit = (user: UserDoc, entries: object[]) =>
  request(app).post("/api/nurse-entries").set(authHeader(user)).send({ patientId: pid(), entries });

describe("katalog usluga nege", () => {
  test("uprava pravi usluge, sestre vide samo aktivne i ne mogu da ih menjaju", async () => {
    const created = await request(app).post("/api/care-tasks").set(authHeader(mainNurse)).send({ name: "Promenjena posteljina", category: "Higijena" });
    assert.equal(created.status, 201);
    await request(app).post("/api/care-tasks").set(authHeader(admin)).send({ name: "Stara usluga", active: false });

    const dup = await request(app).post("/api/care-tasks").set(authHeader(admin)).send({ name: "promenjena POSTELJINA" });
    assert.equal(dup.status, 409, "isti naziv bez obzira na velika slova");

    const asNurse = await request(app).get("/api/care-tasks").set(authHeader(nurse));
    assert.deepEqual(asNurse.body.tasks.map((t: { name: string }) => t.name), ["Promenjena posteljina"]);
    assert.equal((await request(app).post("/api/care-tasks").set(authHeader(nurse)).send({ name: "X" })).status, 403);

    const all = await request(app).get("/api/care-tasks?all=1").set(authHeader(admin));
    assert.equal(all.body.tasks.length, 2);
  });

  test("korišćena usluga se arhivira umesto brisanja", async () => {
    const task = await CareTask.create({ name: "Kupanje" });
    await submit(nurse, [{ type: "care", itemId: String(task._id) }]);
    const res = await request(app).delete(`/api/care-tasks/${task._id}`).set(authHeader(admin));
    assert.equal(res.body.archived, true);
    assert.equal(must(await CareTask.findById(task._id)).active, false);
    assert.equal((await submit(nurse, [{ type: "care", itemId: String(task._id) }])).status, 400, "arhivirana se ne nudi");
  });
});

describe("unos sestre", () => {
  test("lek ide na odobrenje: ne menja stanje ni specifikaciju dok uprava ne prihvati", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const res = await request(app).post("/api/medicine/use").set(authHeader(nurse)).send({ patientId: pid(), medicineId: String(med._id), amount: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Poslato upravi na odobrenje.");

    assert.equal(must(await Medicine.findById(med._id)).quantity, 10);
    assert.equal((await spec()).totalPrice, 0);
    const entry = must(await NurseEntry.findOne({ patient: patient._id }));
    assert.equal(entry.status, "pending");
    assert.equal(entry.name, "Andol");
  });

  test("usluga bez naplate se samo beleži, naplativa čeka", async () => {
    const free = await CareTask.create({ name: "Promenjena posteljina" });
    const diaper = await Article.create({ name: "Pelene", price: 85, quantity: 100 });
    const paid = await CareTask.create({ name: "Promenjene pelene", article: diaper._id, articleAmount: 1 });

    const res = await submit(nurse, [
      { type: "care", itemId: String(free._id) },
      { type: "care", itemId: String(paid._id), amount: 3, note: "noćna smena" },
    ]);
    assert.equal(res.status, 201);
    assert.equal(res.body.message, "Poslato upravi na odobrenje.");
    assert.deepEqual(res.body.entries.map((e: { status: string }) => e.status).sort(), ["logged", "pending"]);
  });

  test("jedan neispravan unos ne upisuje ni ostale", async () => {
    const free = await CareTask.create({ name: "Kupanje" });
    const res = await submit(nurse, [{ type: "care", itemId: String(free._id) }, { type: "care", itemId: "64b000000000000000000000" }]);
    assert.equal(res.status, 404);
    assert.equal(await NurseEntry.countDocuments(), 0);
  });

  test("otpušten pacijent i budući datum se odbijaju", async () => {
    const task = await CareTask.create({ name: "Kupanje" });
    const future = await submit(nurse, [{ type: "care", itemId: String(task._id), performedAt: new Date(Date.now() + 3_600_000).toISOString() }]);
    assert.equal(future.status, 400);

    await patient.updateOne({ dischargeDate: new Date() });
    assert.equal((await submit(nurse, [{ type: "care", itemId: String(task._id) }])).status, 409);
  });

  test("sestra povlači svoj unos dok čeka, tuđi ne može", async () => {
    const task = await CareTask.create({ name: "Kupanje" });
    const { body } = await submit(nurse, [{ type: "care", itemId: String(task._id) }]);
    const id = body.entries[0]._id;
    assert.equal((await request(app).delete(`/api/nurse-entries/${id}`).set(authHeader(otherNurse))).status, 403);
    assert.equal((await request(app).delete(`/api/nurse-entries/${id}`).set(authHeader(nurse))).status, 200);
    assert.equal(await NurseEntry.countDocuments(), 0);
  });

  test("sestra ne može da odobrava ni da vidi sve unose bez pacijenta", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 1 }]);
    const id = body.entries[0]._id;
    assert.equal((await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(otherNurse))).status, 403);
    assert.equal((await request(app).get("/api/nurse-entries").set(authHeader(nurse))).status, 403);
    assert.equal((await request(app).get(`/api/nurse-entries?patientId=${pid()}`).set(authHeader(nurse))).body.entries.length, 1);
    assert.equal((await request(app).get("/api/nurse-entries?mine=1").set(authHeader(otherNurse))).body.entries.length, 0);
  });
});

describe("dnevnik nege (uprava)", () => {
  test("filter po sestri, vrsti i periodu; sestra ne može da gleda tuđe", async () => {
    const task = await CareTask.create({ name: "Kupanje" });
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    await submit(nurse, [{ type: "care", itemId: String(task._id) }, { type: "medicine", itemId: String(med._id), amount: 1 }]);
    await submit(otherNurse, [{ type: "care", itemId: String(task._id), performedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);

    const get = (q: string, user: UserDoc = admin) => request(app).get(`/api/nurse-entries?${q}`).set(authHeader(user));
    assert.equal((await get(`createdBy=${nurse._id}`)).body.entries.length, 2);
    assert.equal((await get(`createdBy=${nurse._id}&type=care`)).body.entries.length, 1);
    assert.equal((await get(`type=care&from=${new Date(Date.now() - 86_400_000).toISOString()}`)).body.entries.length, 1);
    assert.equal((await get("type=care")).body.entries.length, 2);
    assert.equal((await get(`patientId=${pid()}&createdBy=${nurse._id}`, otherNurse)).status, 403);
  });
});

describe("odobravanje", () => {
  test("prihvatanje: prvo porodično stanje, ostatak u specifikaciju; autor ostaje sestra", async () => {
    const diaper = await Article.create({ name: "Pelene", price: 85, quantity: 100 });
    await PatientArticle.create({ patient: patient._id, article: diaper._id, quantity: 1 });
    const task = await CareTask.create({ name: "Promenjene pelene", article: diaper._id, articleAmount: 1 });
    const { body } = await submit(nurse, [{ type: "care", itemId: String(task._id), amount: 3 }]);
    const id = body.entries[0]._id;

    const summary = await request(app).get("/api/nurse-entries/pending-summary").set(authHeader(admin));
    assert.equal(summary.body.total, 1);
    assert.equal(String(summary.body.byPatient[0].patientId), pid());

    const res = await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin));
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.entry.status, "accepted");
    assert.equal(res.body.entry.chargedPrice, 170, "1 sa porodičnog, 2 × 85 naplaćeno");

    assert.equal(must(await Article.findById(diaper._id)).quantity, 98);
    assert.equal(must(await PatientArticle.findOne({ patient: patient._id })).quantity, 0);
    const s = await spec();
    assert.equal(s.totalPrice, 170);
    assert.equal(String(s.items[0].entries[0].createdBy), String(nurse._id));

    const again = await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin));
    assert.equal(again.status, 409, "drugi klik ne naplaćuje ponovo");
    assert.equal((await spec()).totalPrice, 170);
  });

  test("istovremeno prihvatanje istog unosa naplati samo jednom", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 2 }]);
    const id = body.entries[0]._id;
    const results = await Promise.all([
      request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin)),
      request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(mainNurse)),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 8);
    assert.equal((await spec()).totalPrice, 100);
  });

  test("uprava može da ispravi količinu pri prihvatanju", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 20 }]);
    const res = await request(app).post(`/api/nurse-entries/${body.entries[0]._id}/accept`).set(authHeader(admin)).send({ amount: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.entry.acceptedAmount, 1);
    assert.equal((await spec()).totalPrice, 50);
  });

  test("nedovoljno na stanju: unos ostaje na čekanju sa jasnom porukom", async () => {
    const med = await Medicine.create({ name: "Brufen", pricePerUnit: 28, quantity: 1 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 5 }]);
    const res = await request(app).post(`/api/nurse-entries/${body.entries[0]._id}/accept`).set(authHeader(admin));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Nedovoljno/);
    assert.equal(must(await NurseEntry.findById(body.entries[0]._id)).status, "pending");
  });

  test("usluga sa cenom i artiklom: ako artikla nema, ni cena se ne naplati", async () => {
    const diaper = await Article.create({ name: "Pelene", price: 85, quantity: 0 });
    const task = await CareTask.create({ name: "Kupanje uz pelene", article: diaper._id, articleAmount: 1, price: 500 });
    const { body } = await submit(nurse, [{ type: "care", itemId: String(task._id) }]);
    const res = await request(app).post(`/api/nurse-entries/${body.entries[0]._id}/accept`).set(authHeader(admin));
    assert.equal(res.status, 400);
    assert.equal((await spec()).totalPrice, 0);
    assert.equal((await spec()).items.length, 0);
  });

  test("odbijanje: ništa se ne naplaćuje ni ne skida, razlog se pamti", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 2 }]);
    const id = body.entries[0]._id;
    const res = await request(app).post(`/api/nurse-entries/${id}/reject`).set(authHeader(admin)).send({ reason: "Dupli unos" });
    assert.equal(res.status, 200);
    assert.equal(res.body.entry.rejectReason, "Dupli unos");
    assert.equal(must(await Medicine.findById(med._id)).quantity, 10);
    assert.equal((await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin))).status, 409);
  });

  test("grupno prihvatanje vraća ishod za svaki unos", async () => {
    const ok = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const low = await Medicine.create({ name: "Brufen", pricePerUnit: 28, quantity: 0 });
    const { body } = await submit(nurse, [
      { type: "medicine", itemId: String(ok._id), amount: 1 },
      { type: "medicine", itemId: String(low._id), amount: 1 },
    ]);
    const res = await request(app)
      .post("/api/nurse-entries/accept")
      .set(authHeader(admin))
      .send({ items: body.entries.map((e: { _id: string }) => ({ id: e._id })) });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, "Prihvaćeno 1 od 2.");
    assert.deepEqual(res.body.results.map((r: { ok: boolean }) => r.ok).sort(), [false, true]);
  });

  test("brisanje stavke iz specifikacije vraća unos na odobrenje i stanje na lager", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const { body } = await submit(nurse, [{ type: "medicine", itemId: String(med._id), amount: 2 }]);
    const id = body.entries[0]._id;
    await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin));

    const s = await spec();
    const del = await request(app).delete(`/api/specification/${s._id}/item/${s.items[0]._id}`).set(authHeader(admin));
    assert.equal(del.status, 200);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 10);
    const entry = must(await NurseEntry.findById(id));
    assert.equal(entry.status, "pending");
    assert.equal(entry.chargedPrice, 0);

    assert.equal((await request(app).post(`/api/nurse-entries/${id}/accept`).set(authHeader(admin))).status, 200, "može ponovo");
    assert.equal((await spec()).totalPrice, 100);
  });

  test("unos uprave se odmah primenjuje, bez odobravanja", async () => {
    const task = await CareTask.create({ name: "Prevoz do bolnice", price: 1500 });
    const res = await submit(mainNurse, [{ type: "care", itemId: String(task._id) }]);
    assert.equal(res.status, 201);
    assert.equal(res.body.entries[0].status, "accepted");
    assert.equal((await spec()).totalPrice, 1500);
  });
});
