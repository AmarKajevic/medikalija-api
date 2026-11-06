import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import Article from "../../models/Articles.js";
import Analysis from "../../models/Analysis.js";
import PatientMedicine from "../../models/PatientMedicine.js";
import MedicineReserve from "../../models/medicineReserve.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
});

describe("lekovi", () => {
  test("dopuna pakovanjima preračunava broj pakovanja", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 10, quantity: 5, unitsPerPackage: 30 });
    const res = await request(app).put(`/api/medicine/${med._id}`).set(authHeader(admin)).send({ packages: 2, addQuantity: 3 });
    assert.equal(res.status, 200);
    const saved = must(await Medicine.findById(med._id));
    assert.equal(saved.quantity, 68);
    assert.equal(saved.packageCount, 2);
  });

  test("porodično stanje preskače lek obrisan iz šifarnika (ranije 500)", async () => {
    const patient = await createPatient();
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    await PatientMedicine.create({ patient: patient._id, medicine: med._id, quantity: 4 });
    await Medicine.deleteOne({ _id: med._id });

    const res = await request(app).get(`/api/medicine/patient/${patient._id}/stock`).set(authHeader(nurse));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.medicines, []);
  });
});

describe("artikli", () => {
  test("promena naziva, sa zabranom duplikata", async () => {
    const a = await Article.create({ name: "Pelene", price: 5, quantity: 5 });
    await Article.create({ name: "Maramice", price: 2, quantity: 5 });

    const ok = await request(app).put(`/api/articles/${a._id}`).set(authHeader(admin)).send({ name: "Pelene XL" });
    assert.equal(ok.status, 200);
    assert.equal(must(await Article.findById(a._id)).name, "Pelene XL");

    const dup = await request(app).put(`/api/articles/${a._id}`).set(authHeader(admin)).send({ name: "Maramice" });
    assert.equal(dup.status, 400);
  });

  test("porodično stanje bez artikala je prazna lista, ne 404", async () => {
    const patient = await createPatient();
    const res = await request(app).get(`/api/articles/patient/${patient._id}`).set(authHeader(nurse));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.articles, []);
  });
});

describe("analize", () => {
  test("izmena menja i naziv (ranije se naziv ignorisao)", async () => {
    const a = await Analysis.create({ name: "KKS", price: 400, createdBy: admin._id });
    const res = await request(app).put(`/api/analysis/${a._id}`).set(authHeader(admin)).send({ name: "Kompletna krvna slika", price: 450 });
    assert.equal(res.status, 200);
    const saved = must(await Analysis.findById(a._id));
    assert.equal(saved.name, "Kompletna krvna slika");
    assert.equal(saved.price, 450);
  });

  test("dupli naziv (bez obzira na velika slova) → 409", async () => {
    await Analysis.create({ name: "CRP", price: 600, createdBy: admin._id });
    const res = await request(app).post("/api/analysis").set(authHeader(admin)).send({ name: "crp", price: 1 });
    assert.equal(res.status, 409);
  });

  test("negativna cena → 400", async () => {
    const res = await request(app).post("/api/analysis").set(authHeader(admin)).send({ name: "Urea", price: -5 });
    assert.equal(res.status, 400);
  });
});

describe("rezerva lekova", () => {
  test("rezerva sa stanja doma ne može 'nazad pacijentu' i količina ostaje", async () => {
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    const item = await MedicineReserve.create({ medicine: med._id, name: "Andol", amount: 10, source: "home" });

    const res = await request(app).post("/api/medicine-reserve/return").set(authHeader(admin)).send({ reserveId: String(item._id), amount: 4, destination: "family" });

    assert.equal(res.status, 400);
    assert.equal(must(await MedicineReserve.findById(item._id)).amount, 10);
    assert.equal(await PatientMedicine.countDocuments(), 0);
  });

  test("vraćanje u dom leka koji više ne postoji ne gubi količinu", async () => {
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    const item = await MedicineReserve.create({ medicine: med._id, name: "Andol", amount: 10, source: "home" });
    await Medicine.deleteOne({ _id: med._id });

    const res = await request(app).post("/api/medicine-reserve/return").set(authHeader(admin)).send({ reserveId: String(item._id), amount: 4, destination: "home" });

    assert.equal(res.status, 404);
    assert.equal(must(await MedicineReserve.findById(item._id)).amount, 10);
  });

  test("povraćaj porodici vraća pacijentu i smanjuje rezervu", async () => {
    const patient = await createPatient();
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    const item = await MedicineReserve.create({ medicine: med._id, patient: patient._id, name: "Andol", amount: 10, source: "family" });

    const res = await request(app).post("/api/medicine-reserve/return").set(authHeader(admin)).send({ reserveId: String(item._id), amount: 4, destination: "family" });

    assert.equal(res.status, 200);
    assert.equal(must(await MedicineReserve.findById(item._id)).amount, 6);
    assert.equal(must(await PatientMedicine.findOne({ patient: patient._id })).quantity, 4);
  });

  test("sestra ne može da vraća ni otpisuje iz rezerve", async () => {
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    const item = await MedicineReserve.create({ medicine: med._id, name: "Andol", amount: 10, source: "home" });
    assert.equal((await request(app).post("/api/medicine-reserve/return").set(authHeader(nurse)).send({ reserveId: String(item._id), amount: 1, destination: "home" })).status, 403);
    assert.equal((await request(app).delete(`/api/medicine-reserve/${item._id}`).set(authHeader(nurse))).status, 403);
  });
});
