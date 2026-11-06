import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import GlobalSetting from "../../models/GlobalSetting.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
  patient = await createPatient();
});

const activeSpec = async (user: UserDoc = admin) => {
  const res = await request(app).get(`/api/specification/${patient._id}`).set(authHeader(user));
  assert.equal(res.status, 200);
  return must(res.body.specification, "specifikacija");
};

describe("tok specifikacije preko API-ja", () => {
  test("lek → stavka; dodatni trošak; brisanje vraća stanje", async () => {
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });

    const used = await request(app).post("/api/medicine/use").set(authHeader(admin)).send({ patientId: String(patient._id), medicineId: String(med._id), amount: 2 });
    assert.equal(used.status, 200);
    assert.equal(used.body.specification.totalPrice, 100);

    const spec = await activeSpec();
    const cost = await request(app).post(`/api/specification/${spec._id}/add-costs`).set(authHeader(admin)).send({ extraCostAmount: 300, extraCostLabel: "Frizer" });
    assert.equal(cost.status, 200);
    assert.equal(cost.body.specification.totalPrice, 400);

    const item = cost.body.specification.items.find((i: { category: string }) => i.category === "medicine");
    const removed = await request(app).delete(`/api/specification/${spec._id}/item/${item._id}`).set(authHeader(admin));
    assert.equal(removed.status, 200);
    assert.equal(removed.body.fullyReverted, true);
    assert.equal(removed.body.specification.totalPrice, 300);
    assert.equal(must(await Medicine.findById(med._id)).quantity, 10);
  });

  test("sestra ne može da briše stavke ni da dodaje troškove", async () => {
    const spec = await activeSpec(nurse);
    const cost = await request(app).post(`/api/specification/${spec._id}/add-costs`).set(authHeader(nurse)).send({ extraCostAmount: 300 });
    assert.equal(cost.status, 403);
    const del = await request(app).delete(`/api/specification/${spec._id}/item/64b000000000000000000000`).set(authHeader(nurse));
    assert.equal(del.status, 403);
  });

  test("neispravan iznos troška → 400", async () => {
    const spec = await activeSpec();
    const res = await request(app).post(`/api/specification/${spec._id}/add-costs`).set(authHeader(admin)).send({ extraCostAmount: "abc" });
    assert.equal(res.status, 400);
  });

  test("sledeći period se nadovezuje na tekući (30 dana)", async () => {
    const current = await activeSpec();
    const res = await request(app).post(`/api/specification/${patient._id}/activate-next`).set(authHeader(admin));
    assert.equal(res.status, 200);
    const start = new Date(res.body.specification.startDate);
    const end = new Date(res.body.specification.endDate);
    assert.equal(start.getTime() - new Date(current.endDate).getTime(), 86_400_000);
    assert.equal((end.getTime() - start.getTime()) / 86_400_000, 29);
  });

  test("obračun čuva i kurseve i iznose u RSD", async () => {
    await GlobalSetting.create({ lowerExchangeRate: 116, middleExchangeRate: 117 });
    const spec = await activeSpec();
    const res = await request(app).post(`/api/specification/${spec._id}/billing`).set(authHeader(admin)).send({ previousDebtEUR: 10, nextLodgingEUR: 100 });
    assert.equal(res.status, 200);
    const billing = res.body.specification.billing;
    assert.equal(billing.middleExchangeRate, 117);
    assert.equal(billing.previousDebtRSD, 1170);
    assert.equal(billing.nextLodgingRSD, 11700);
    assert.equal(billing.totalEUR, 110);
  });
});
