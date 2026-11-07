// Period specifikacije (period pre aktivnog, koji je poslednji istekao): rad u njemu,
// raspoređivanje unosa sestara po datumu, opcioni dug i smeštaj.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Medicine from "../../models/Medicine.js";
import Combination from "../../models/Combination.js";
import Analysis from "../../models/Analysis.js";
import GlobalSetting from "../../models/GlobalSetting.js";
import { authHeader, createPatient, createUser, DAY_MS, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";
import { today } from "../../utils/dateUtils.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
});

const day = (offset: number) => new Date(today().getTime() + offset * DAY_MS);
const key = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const get = (url: string, user: UserDoc = admin) => request(app).get(url).set(authHeader(user));
const post = (url: string, body: object, user: UserDoc = admin) => request(app).post(url).set(authHeader(user)).send(body);

async function setup(admittedDaysAgo: number) {
  const patient = await createPatient({ admissionDate: day(-admittedDaysAgo) });
  const active = (await get(`/api/specification/${patient._id}`)).body.specification;
  const billing = (await get(`/api/specification/${patient._id}/billing-period`)).body.specification;
  return { patient, active, billing };
}

describe("period specifikacije", () => {
  test("period pre aktivnog: tačno 30 dana, završava se dan pre aktivnog", async () => {
    const { active, billing } = await setup(45);
    assert.equal(key(active.startDate), key(day(-15)));
    assert.equal(key(billing.startDate), key(day(-45)));
    assert.equal(key(billing.endDate), key(day(-16)));
    assert.equal(billing.isActive, false);
  });

  test("u prvom periodu nema perioda specifikacije", async () => {
    const { billing } = await setup(5);
    assert.equal(billing, null);
  });

  test("posle prelaska na sledeći period, period specifikacije je onaj koji je bio aktivan", async () => {
    const { patient, active } = await setup(10);
    await post(`/api/specification/${patient._id}/activate-next`, {});
    const billing = (await get(`/api/specification/${patient._id}/billing-period`)).body.specification;
    assert.equal(billing._id, active._id);
  });

  test("lek se dodaje u izabrani period; drugi stari period se odbija", async () => {
    const { patient, active, billing } = await setup(75);
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const use = (specificationId?: string) => post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1, specificationId });

    const toBilling = await use(billing._id);
    assert.equal(toBilling.status, 200, toBilling.body.message);
    assert.equal(toBilling.body.specification._id, billing._id);
    assert.equal((await get(`/api/specification/${patient._id}`)).body.specification.items.length, 0, "aktivan period nije diran");

    assert.equal((await use()).body.specification._id, active._id, "bez izbora: aktivan period");

    const history = (await get(`/api/specification/history/${patient._id}`)).body.history;
    const oldest = history.find((s: { _id: string }) => s._id !== billing._id);
    if (oldest) assert.equal((await use(oldest._id)).status, 409);
  });

  test("unos sestre ide u period u koji pada dan kad je dato", async () => {
    const { patient, billing, active } = await setup(45);
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const entries = (await post("/api/nurse-entries", {
      patientId: String(patient._id),
      entries: [
        { type: "medicine", itemId: String(med._id), amount: 1, performedAt: day(-20).toISOString() },
        { type: "medicine", itemId: String(med._id), amount: 2 },
      ],
    }, nurse)).body.entries;
    const res = await post("/api/nurse-entries/accept", { items: entries.map((e: { _id: string }) => ({ id: e._id })) });
    assert.equal(res.body.message, "Prihvaćeno: 2.");
    assert.equal(must((await get(`/api/specification/view/${billing._id}`)).body.specification).totalPrice, 50);
    assert.equal(must((await get(`/api/specification/view/${active._id}`)).body.specification).totalPrice, 100);
  });

  test("analize u period specifikacije; sestra ne može da dodaje analize", async () => {
    const { patient, billing } = await setup(45);
    const a = await Analysis.create({ name: "KKS", price: 450, createdBy: admin._id });
    const combo = await Combination.create({ name: "Krvna slika", analyses: [a._id] });
    const url = `/api/analysis/combination/addToPatient/${patient._id}`;
    assert.equal((await post(url, { combinationId: String(combo._id) }, nurse)).status, 403);
    const res = await post(url, { combinationId: String(combo._id), specificationId: billing._id });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.specification._id, billing._id);
  });
});

describe("obračun: dug i smeštaj su opcioni", () => {
  test("isključen dug se ne naplaćuje; smeštaj uključen", async () => {
    await GlobalSetting.create({ lowerExchangeRate: 100, middleExchangeRate: 120 });
    const { active } = await setup(5);
    const res = await post(`/api/specification/${active._id}/billing`, { previousDebtEUR: 50, includeDebt: false, nextLodgingEUR: 900, includeLodging: true });
    assert.equal(res.status, 200);
    const b = res.body.specification.billing;
    assert.equal(b.includeDebt, false);
    assert.equal(b.previousDebtEUR, 0);
    assert.equal(b.includeLodging, true);
    assert.equal(b.nextLodgingEUR, 900);
    assert.equal(b.totalEUR, 900);
  });

  test("bez prekidača (stari klijent): uključeno ako je iznos veći od nule", async () => {
    const { active } = await setup(5);
    const b = (await post(`/api/specification/${active._id}/billing`, { previousDebtEUR: 10, nextLodgingEUR: 0 })).body.specification.billing;
    assert.equal(b.includeDebt, true);
    assert.equal(b.includeLodging, false);
  });

  test("sestra ne može da menja obračun", async () => {
    const { active } = await setup(5);
    assert.equal((await post(`/api/specification/${active._id}/billing`, { previousDebtEUR: 1 }, nurse)).status, 403);
  });
});
