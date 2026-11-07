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
import Specification from "../../models/Specification.js";
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

  test("lek se dodaje u ručno izabran raniji period; budući i tuđi se odbijaju", async () => {
    const { patient, active, billing } = await setup(75);
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const use = (specificationId?: string) => post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1, specificationId });

    const toBilling = await use(billing._id);
    assert.equal(toBilling.status, 200, toBilling.body.message);
    assert.equal(toBilling.body.specification._id, billing._id);
    assert.equal((await get(`/api/specification/${patient._id}`)).body.specification.items.length, 0, "aktivan period nije diran");

    assert.equal((await use()).body.specification._id, active._id, "bez izbora: aktivan period");

    // Najstariji period (pre perioda specifikacije) — ručno izabran
    const oldest = await Specification.create({ patientId: patient._id, startDate: day(-75), endDate: day(-46), items: [], totalPrice: 0 });
    const toOldest = await use(String(oldest._id));
    assert.equal(toOldest.status, 200, toOldest.body.message);
    assert.equal(toOldest.body.specification._id, String(oldest._id));

    const future = await Specification.create({ patientId: patient._id, startDate: day(40), endDate: day(69), items: [], totalPrice: 0 });
    assert.equal((await use(String(future._id))).status, 409, "budući period");
    const other = await createPatient({ admissionDate: day(-75) });
    const foreign = await Specification.create({ patientId: other._id, startDate: day(-75), endDate: day(-46), items: [], totalPrice: 0 });
    assert.equal((await use(String(foreign._id))).status, 404, "period drugog pacijenta");
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

  test("unos sestre iz starijeg perioda ide u taj period ako postoji", async () => {
    const { patient } = await setup(75);
    const oldest = await Specification.create({ patientId: patient._id, startDate: day(-75), endDate: day(-46), items: [], totalPrice: 0 });
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const entries = (await post("/api/nurse-entries", {
      patientId: String(patient._id),
      entries: [{ type: "medicine", itemId: String(med._id), amount: 1, performedAt: day(-60).toISOString() }],
    }, nurse)).body.entries;
    await post("/api/nurse-entries/accept", { items: entries.map((e: { _id: string }) => ({ id: e._id })) });
    assert.equal(must((await get(`/api/specification/view/${oldest._id}`)).body.specification).totalPrice, 50);
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

describe("svi raniji periodi", () => {
  test("od prijema do aktivnog, od najnovijeg; postojeći zapisi + mreža od 30 dana", async () => {
    const { patient, active, billing } = await setup(365);
    const res = await get(`/api/specification/${patient._id}/past-periods`);
    assert.equal(res.status, 200);
    const periods: { startDate: string; endDate: string; specificationId: string | null }[] = res.body.periods;
    // 365 dana = 12 celih perioda pre aktivnog (aktivan je 13.)
    assert.equal(periods.length, 12);
    assert.equal(periods[0]!.specificationId, billing._id, "prvi je period specifikacije (najnoviji)");
    assert.equal(key(periods[periods.length - 1]!.startDate), key(day(-365)), "poslednji počinje danom prijema");
    for (let i = 1; i < periods.length; i++) {
      assert.ok(periods[i - 1]!.startDate > periods[i]!.startDate, "od najnovijeg ka starijem");
      assert.equal(key(new Date(new Date(periods[i]!.endDate).getTime() + DAY_MS)), key(periods[i - 1]!.startDate), "bez rupa");
    }
    assert.ok(periods.every((p) => p.specificationId !== active._id && key(p.startDate) < key(active.startDate)));
    assert.equal((await get(`/api/specification/${patient._id}/past-periods`, nurse)).status, 403);
  });

  test("otvaranje ranijeg perioda ne menja aktivan; budući se ne otvara", async () => {
    const { patient, active } = await setup(365);
    const oldest = (await get(`/api/specification/${patient._id}/past-periods`)).body.periods.pop();
    const opened = await post(`/api/specification/${patient._id}/periods`, { startDate: key(oldest.startDate), endDate: key(oldest.endDate) });
    assert.equal(opened.status, 200, opened.body.message);
    assert.equal(opened.body.specification.isActive, false);
    assert.equal((await get(`/api/specification/${patient._id}`)).body.specification._id, active._id);
    const again = (await get(`/api/specification/${patient._id}/past-periods`)).body.periods.pop();
    assert.equal(again.specificationId, opened.body.specification._id);
    assert.equal((await post(`/api/specification/${patient._id}/periods`, { startDate: key(active.startDate), endDate: key(active.endDate) })).status, 409);
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
