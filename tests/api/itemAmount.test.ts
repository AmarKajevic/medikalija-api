// Izmena količine stavke u specifikaciji: lek/artikal menja stanje doma, analize se ponavljaju.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import UsedMedicine from "../../models/UsedMedicine.js";
import UsedCombinations from "../../models/UsedCombinations.js";
import Analysis from "../../models/Analysis.js";
import Combination from "../../models/Combination.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;
beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
});

const post = (url: string, body: object) => request(app).post(url).set(authHeader(admin)).send(body);
const patch = (url: string, body: object, user: UserDoc = admin) => request(app).patch(url).set(authHeader(user)).send(body);

describe("izmena količine stavke", () => {
  test("lek: povećanje skida sa stanja, smanjenje vraća; cena prati količinu", async () => {
    const patient = await createPatient();
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 10, quantity: 20 });
    const spec = (await post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 5 })).body.specification;
    const item = spec.items[0];
    const url = `/api/specification/${spec._id}/item/${item._id}`;

    const up = await patch(url, { amount: 8 });
    assert.equal(up.status, 200, up.body.message);
    assert.equal(up.body.specification.items[0].amount, 8);
    assert.equal(up.body.specification.items[0].price, 80);
    assert.equal(up.body.specification.totalPrice, 80);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 12);

    const down = await patch(url, { amount: 2 });
    assert.equal(down.status, 200, down.body.message);
    assert.equal(down.body.specification.items[0].price, 20);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 18);
    const used = await UsedMedicine.find({ patient: patient._id });
    assert.equal(used.reduce((s, u) => s + u.amount, 0), 2, "zapisi o potrošnji prate količinu");

    assert.equal((await patch(url, { amount: 0 })).status, 400);
    assert.equal((await patch(url, { amount: 100 })).status, 400, "nema dovoljno na stanju");
    assert.equal((await patch(url, { amount: 3 }, nurse)).status, 403);
  });

  test("analize: broj ponavljanja; trošak: cena po komadu", async () => {
    const patient = await createPatient();
    const a = await Analysis.create({ name: "KKS", price: 450, createdBy: admin._id });
    const combo = await Combination.create({ name: "Krvna slika", analyses: [a._id] });
    const spec = (await post(`/api/analysis/combination/addToPatient/${patient._id}`, { combinationId: String(combo._id) })).body.specification;
    const item = spec.items[0];
    const res = await patch(`/api/specification/${spec._id}/item/${item._id}`, { amount: 3 });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.specification.items[0].price, 1350);
    assert.equal(await UsedCombinations.countDocuments({ patient: patient._id }), 3);
    assert.equal((await patch(`/api/specification/${spec._id}/item/${item._id}`, { amount: 1.5 })).status, 400);
    await patch(`/api/specification/${spec._id}/item/${item._id}`, { amount: 1 });
    assert.equal(await UsedCombinations.countDocuments({ patient: patient._id }), 1);

    const withCost = (await post(`/api/specification/${spec._id}/add-costs`, { extraCostAmount: 500, extraCostLabel: "Frizer" })).body.specification;
    const cost = withCost.items.find((i: { name: string }) => i.name === "Frizer");
    const c = await patch(`/api/specification/${spec._id}/item/${cost._id}`, { amount: 2 });
    assert.equal(c.body.specification.items.find((i: { name: string }) => i.name === "Frizer").price, 1000);
  });
});
