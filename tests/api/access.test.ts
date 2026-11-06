// Ko sme šta: bezbednosne ispravke iz pregleda aplikacije ne smeju da se vrate.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import Article from "../../models/Articles.js";
import PatientMedicine from "../../models/PatientMedicine.js";
import UsedMedicine from "../../models/UsedMedicine.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let mainNurse: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  mainNurse = await createUser("main-nurse");
  nurse = await createUser("nurse");
});

describe("pretraga", () => {
  test("bez prijave nije dostupna (imena pacijenata su zdravstveni podaci)", async () => {
    await createPatient({ name: "Milica" });
    const res = await request(app).get("/api/search?q=mil");
    assert.equal(res.status, 401);
  });

  test("regex znakovi se tretiraju doslovno", async () => {
    await createPatient({ name: "Milica" });
    await Medicine.create({ name: "Andol", quantity: 1 });

    const all = await request(app).get("/api/search?q=.*").set(authHeader(nurse));
    assert.equal(all.status, 200);
    assert.equal(all.body.results.length, 0, "'.*' ne sme da vrati sve");

    const hit = await request(app).get("/api/search?q=mil").set(authHeader(nurse));
    assert.equal(hit.body.results.length, 1);
  });
});

describe("zalihe doma: samo uprava", () => {
  test("sestra ne sme da menja cenu/stanje leka, glavna sestra sme", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 10, quantity: 5 });

    const asNurse = await request(app).put(`/api/medicine/${med._id}`).set(authHeader(nurse)).send({ pricePerUnit: 1 });
    assert.equal(asNurse.status, 403);
    assert.equal(must(await Medicine.findById(med._id)).pricePerUnit, 10);

    const asMain = await request(app).put(`/api/medicine/${med._id}`).set(authHeader(mainNurse)).send({ pricePerUnit: 12 });
    assert.equal(asMain.status, 200);
    assert.equal(must(await Medicine.findById(med._id)).pricePerUnit, 12);
  });

  test("sestra ne sme da briše lek ni artikal", async () => {
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    const art = await Article.create({ name: "Pelene", price: 5, quantity: 5 });
    assert.equal((await request(app).delete(`/api/medicine/${med._id}`).set(authHeader(nurse))).status, 403);
    assert.equal((await request(app).delete(`/api/articles/${art._id}`).set(authHeader(nurse))).status, 403);
    assert.ok(await Medicine.exists({ _id: med._id }));
  });

  test("sestra ne sme da doda lek na stanje doma, ali sme porodični", async () => {
    await Medicine.create({ name: "Andol", pricePerUnit: 10, quantity: 5 });
    const patient = await createPatient();

    const home = await request(app).post("/api/medicine/add").set(authHeader(nurse)).send({ name: "Andol", pricePerUnit: 10, quantity: 3 });
    assert.equal(home.status, 403);

    const family = await request(app)
      .post("/api/medicine/add")
      .set(authHeader(nurse))
      .send({ name: "Andol", quantity: 3, fromFamily: true, patientId: String(patient._id) });
    assert.equal(family.status, 200);
  });
});

describe("brisanje istorije unosa", () => {
  test("'Obriši sve' sme samo uprava", async () => {
    const patient = await createPatient();
    const med = await Medicine.create({ name: "Andol", quantity: 5 });
    await UsedMedicine.create({ patient: patient._id, medicine: med._id, amount: 1, priceAtTheTime: 1, createdBy: nurse._id });
    const url = `/api/medicine/patient/${patient._id}/medicines/delete-all`;

    assert.equal((await request(app).delete(url).set(authHeader(nurse))).status, 403);
    assert.equal(await UsedMedicine.countDocuments(), 1);

    assert.equal((await request(app).delete(url).set(authHeader(admin))).status, 200);
    assert.equal(await UsedMedicine.countDocuments(), 0);
  });
});

describe("šifarnici", () => {
  test("grupe kombinacija traže prijavu, a izmene upravu", async () => {
    assert.equal((await request(app).get("/api/combinationGroup")).status, 401);
    assert.equal((await request(app).post("/api/combinationGroup").send({ name: "X", combinations: ["1"] })).status, 401);
    const asNurse = await request(app).post("/api/combinationGroup").set(authHeader(nurse)).send({ name: "X", combinations: ["1"] });
    assert.equal(asNurse.status, 403);
  });

  test("analize: sestra čita, ne menja", async () => {
    assert.equal((await request(app).get("/api/analysis").set(authHeader(nurse))).status, 200);
    assert.equal((await request(app).post("/api/analysis").set(authHeader(nurse)).send({ name: "KKS", price: 1 })).status, 403);
  });
});

describe("porodične zalihe ne idu na stanje doma", () => {
  test("unos sa fromFamily povećava stanje pacijenta, a ne doma", async () => {
    const med = await Medicine.create({ name: "Brufen", pricePerUnit: 20, quantity: 8, unitsPerPackage: 10 });
    const patient = await createPatient();

    const res = await request(app)
      .post("/api/medicine/add")
      .set(authHeader(nurse))
      .send({ name: "Brufen", fromFamily: true, patientId: String(patient._id), packages: 1, unitsPerPackage: 10, quantity: 2 });

    assert.equal(res.status, 200);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 8, "stanje doma se ne menja");
    assert.equal(must(await PatientMedicine.findOne({ patient: patient._id })).quantity, 12);
  });

  test("porodični unos bez pacijenta se odbija", async () => {
    await Medicine.create({ name: "Brufen", quantity: 8 });
    const res = await request(app).post("/api/medicine/add").set(authHeader(nurse)).send({ name: "Brufen", fromFamily: true, quantity: 2 });
    assert.equal(res.status, 400);
  });
});
