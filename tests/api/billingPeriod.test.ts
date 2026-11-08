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

describe("ručna izmena datuma perioda", () => {
  const put = (url: string, body: object, user: UserDoc = admin) => request(app).put(url).set(authHeader(user)).send(body);

  test("skraćen period (02.09–25.09 umesto 02.09–01.10): sledeći periodi kreću od 26.09.", async () => {
    // Prijem pre 66 dana: period specifikacije [-36..-7], aktivan [-6..23]
    const { patient, active, billing } = await setup(66);
    const res = await put(`/api/specification/${patient._id}/periods/${billing._id}`, { startDate: key(billing.startDate), endDate: key(day(-13)) });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(key(res.body.specification.endDate), key(day(-13)));

    // Aktivan (nadovezan) se pomera: počinje dan posle novog kraja, ista dužina
    const moved = (await get(`/api/specification/${patient._id}`)).body.specification;
    assert.equal(moved._id, active._id);
    assert.equal(key(moved.startDate), key(day(-12)));
    assert.equal(key(moved.endDate), key(day(17)));

    // Raspored i sledeći period idu od pomerenog kraja
    const schedule = (await get(`/api/specification/${patient._id}/future-spec-periods`)).body.periods;
    const after = schedule.find((p: { startDate: string }) => key(p.startDate) === key(day(18)));
    assert.ok(after, "period posle aktivnog počinje dan posle njegovog kraja");
    assert.equal(key(after.endDate), key(day(47)));
    const next = await post(`/api/specification/${patient._id}/activate-next`, {});
    assert.equal(key(next.body.specification?.startDate ?? next.body.startDate ?? ""), key(day(18)));
  });

  test("raniji periodi prate ručne datume, bez rupa i preklapanja", async () => {
    const { patient } = await setup(200);
    const before = (await get(`/api/specification/${patient._id}/past-periods`)).body.periods;
    const oldest = before[before.length - 1];
    const opened = (await post(`/api/specification/${patient._id}/periods`, { startDate: key(oldest.startDate), endDate: key(oldest.endDate) })).body.specification;
    // Prvi period skraćen na 10 dana
    assert.equal((await put(`/api/specification/${patient._id}/periods/${opened._id}`, { startDate: key(oldest.startDate), endDate: key(day(-191)) })).status, 200);
    const periods = (await get(`/api/specification/${patient._id}/past-periods`)).body.periods.reverse();
    assert.equal(key(periods[0].endDate), key(day(-191)));
    assert.equal(key(periods[1].startDate), key(day(-190)), "sledeći počinje dan posle ručnog kraja");
    for (let i = 1; i < periods.length; i++)
      assert.equal(key(new Date(new Date(periods[i - 1].endDate).getTime() + DAY_MS)), key(periods[i].startDate), "bez rupa");
  });

  test("ne preklapa period sa stavkama; sestra ne menja datume", async () => {
    const { patient, billing, active } = await setup(66);
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    await post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1 });
    // Produžen početak aktivnog unazad preko perioda specifikacije koji je prazan → prazan se ne bi smeo izgubiti ako ima stavke
    await post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1, specificationId: billing._id });
    const res = await put(`/api/specification/${patient._id}/periods/${active._id}`, { startDate: key(day(-20)), endDate: key(active.endDate) });
    assert.equal(res.status, 200, "prethodni period prati novi početak");
    const b = (await get(`/api/specification/view/${billing._id}`)).body.specification;
    assert.equal(key(b.endDate), key(day(-21)));
    const clash = await put(`/api/specification/${patient._id}/periods/${active._id}`, { startDate: key(day(-60)), endDate: key(active.endDate) });
    assert.equal(clash.status, 409);
    assert.match(clash.body.message, /Preklapa se/);
    assert.equal((await put(`/api/specification/${patient._id}/periods/${active._id}`, { startDate: key(day(-6)), endDate: key(day(10)) }, nurse)).status, 403);
  });
});

describe("zatvorene specifikacije", () => {
  test("otpušten pacijent: u izabranu zatvorenu specifikaciju može da se doda; bez izbora ne", async () => {
    const { patient, active } = await setup(10);
    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const out = await request(app).patch(`/api/patient/${patient._id}/discharge`).set(authHeader(admin)).send({ dischargeDate: key(day(0)) });
    assert.equal(out.status, 200, out.body.message);
    const use = (specificationId?: string) => post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1, specificationId });
    assert.equal((await use()).status, 409, "bez izbora nema aktivnog perioda");
    const res = await use(active._id);
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.specification._id, active._id);
    const other = await createPatient();
    const foreign = (await get(`/api/specification/${other._id}`)).body.specification;
    assert.equal((await use(foreign._id)).status, 409, "tuđa specifikacija");
  });
});

describe("istorija specifikacija", () => {
  test("lista perioda bez stavki (samo broj stavki i iznosi), najnoviji prvi", async () => {
    const { patient, active, billing } = await setup(45);
    await post(`/api/specification/${billing._id}/add-costs`, { extraCostAmount: 300, extraCostLabel: "Prevoz" });
    await post(`/api/specification/${billing._id}/add-costs`, { extraCostAmount: 200, extraCostLabel: "Frizer" });
    const res = await get(`/api/specification/history/${patient._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.activeSpec._id, active._id);
    const old = res.body.history.find((s: { _id: string }) => s._id === billing._id);
    assert.equal(old.itemsCount, 2);
    assert.equal(old.totalPrice, 500);
    assert.equal(old.items, undefined, "stavke se ne šalju u listi");
    assert.equal((await get("/api/specification/history/nije-id")).status, 400);
  });
});

describe("vanstandardni period", () => {
  test("ručni datumi van redovnog niza: prima stavke, ne pomera redovne periode", async () => {
    const { patient, active, billing } = await setup(66);
    const before = (await get(`/api/specification/${patient._id}/past-periods`)).body.periods;
    // Preklapa se sa periodom specifikacije, ali ga ne dira
    const opened = await post(`/api/specification/${patient._id}/non-standard`, { startDate: key(day(-20)), endDate: key(day(-15)) });
    assert.equal(opened.status, 200, opened.body.message);
    const ns = opened.body.specification;
    assert.equal(ns.nonStandard, true);
    assert.equal(ns.isActive, false);

    const again = await post(`/api/specification/${patient._id}/non-standard`, { startDate: key(day(-20)), endDate: key(day(-15)) });
    assert.equal(again.body.specification._id, ns._id, "isti datumi otvaraju isti period");

    const med = await Medicine.create({ name: "Andol", pricePerUnit: 50, quantity: 10 });
    const use = await post("/api/medicine/use", { patientId: String(patient._id), medicineId: String(med._id), amount: 1, specificationId: ns._id });
    assert.equal(use.status, 200, use.body.message);
    assert.equal(use.body.specification._id, ns._id);

    assert.equal((await get(`/api/specification/${patient._id}`)).body.specification._id, active._id);
    assert.equal((await get(`/api/specification/${patient._id}/billing-period`)).body.specification._id, billing._id);
    assert.deepEqual((await get(`/api/specification/${patient._id}/past-periods`)).body.periods, before, "raniji periodi isti");
    const list = (await get(`/api/specification/${patient._id}/non-standard`)).body.specifications;
    assert.deepEqual(list.map((s: { _id: string }) => s._id), [ns._id]);

    // Izmena datuma menja samo njega
    const changed = await request(app).put(`/api/specification/${patient._id}/periods/${ns._id}`).set(authHeader(admin)).send({ startDate: key(day(-22)), endDate: key(day(-15)) });
    assert.equal(changed.status, 200);
    assert.equal(key(changed.body.specification.startDate), key(day(-22)));
    assert.equal(key((await get(`/api/specification/view/${billing._id}`)).body.specification.endDate), key(billing.endDate));
    assert.equal((await post(`/api/specification/${patient._id}/non-standard`, { startDate: key(day(-1)), endDate: key(day(-5)) })).status, 400);
  });
});

describe("obračun: dug i smeštaj su opcioni", () => {
  test("vanstandardni period smeštaja: opcion, po srednjem kursu, ulazi u ukupno", async () => {
    await GlobalSetting.create({ lowerExchangeRate: 100, middleExchangeRate: 120 });
    const { active } = await setup(5);
    const on = (await post(`/api/specification/${active._id}/billing`, { previousDebtEUR: 0, nextLodgingEUR: 0, earlyLodgingEUR: 200, includeEarlyLodging: true })).body.specification.billing;
    assert.equal(on.includeEarlyLodging, true);
    assert.equal(on.earlyLodgingRSD, 24000);
    assert.equal(on.totalEUR, 200);
    const off = (await post(`/api/specification/${active._id}/billing`, { earlyLodgingEUR: 200, includeEarlyLodging: false })).body.specification.billing;
    assert.equal(off.earlyLodgingEUR, 0);
    assert.equal(off.totalRSD, 0);
  });

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
