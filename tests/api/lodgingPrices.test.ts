// Cenovnik smeštaja: admin ga pravi, uprava bira cenu u obračunu.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import GlobalSetting from "../../models/GlobalSetting.js";
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
  post: (url: string, body: object) => request(app).post(url).set(authHeader(user)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(authHeader(user)).send(body),
  del: (url: string) => request(app).delete(url).set(authHeader(user)),
});

describe("cene smeštaja", () => {
  test("admin pravi i menja; uprava čita; sestra nema pristup", async () => {
    const a = as(admin);
    assert.equal((await a.post("/api/lodging-prices", { name: "30 dana", days: 30, priceEUR: 900 })).status, 201);
    assert.equal((await a.post("/api/lodging-prices", { name: "10 dana", days: 10, priceEUR: 200 })).status, 201);
    assert.equal((await a.post("/api/lodging-prices", { name: "10 DANA", priceEUR: 1 })).status, 409, "isti naziv");
    assert.equal((await a.post("/api/lodging-prices", { name: "Bez cene" })).status, 400);

    const list = (await as(mainNurse).get("/api/lodging-prices")).body.prices;
    assert.deepEqual(list.map((p: { name: string }) => p.name), ["10 dana", "30 dana"], "po broju dana");
    assert.equal((await as(mainNurse).post("/api/lodging-prices", { name: "5 dana", priceEUR: 100 })).status, 403);
    assert.equal((await as(nurse).get("/api/lodging-prices")).status, 403);

    const id = list[0]._id;
    assert.equal((await a.put(`/api/lodging-prices/${id}`, { priceEUR: 250, active: false })).body.price.priceEUR, 250);
    assert.equal((await as(mainNurse).get("/api/lodging-prices")).body.prices.length, 1, "neaktivna se ne nudi");
    assert.equal((await a.get("/api/lodging-prices?all=1")).body.prices.length, 2);
    assert.equal((await a.del(`/api/lodging-prices/${id}`)).status, 200);
  });

  test("obračun pamti izabranu cenu smeštaja", async () => {
    await GlobalSetting.create({ lowerExchangeRate: 100, middleExchangeRate: 120 });
    const patient = await createPatient();
    const spec = (await as(admin).get(`/api/specification/${patient._id}`)).body.specification;
    const b = (
      await as(admin).post(`/api/specification/${spec._id}/billing`, {
        nextLodgingEUR: 900,
        includeLodging: true,
        nextLodgingOption: "30 dana",
        earlyLodgingEUR: 200,
        includeEarlyLodging: true,
        earlyLodgingOption: "10 dana",
      })
    ).body.specification.billing;
    assert.equal(b.nextLodgingOption, "30 dana");
    assert.equal(b.earlyLodgingOption, "10 dana");
    assert.equal(b.totalEUR, 1100);
  });
});
