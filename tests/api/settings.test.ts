// Podešavanja ustanove (naziv, logo, podaci za PDF) i kursna lista.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import { authHeader, createUser, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let mainNurse: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  mainNurse = await createUser("main-nurse");
  nurse = await createUser("nurse");
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("podaci o ustanovi", () => {
  test("javno dostupni (prikazuju se na prijavi), sa podrazumevanim vrednostima", async () => {
    const res = await request(app).get("/api/settings/facility");
    assert.equal(res.status, 200);
    assert.equal(res.body.facility.name, "Medikalija");
    assert.equal(res.body.facility.subtitle, "Dom za stara lica");
    assert.equal(res.body.facility.logo, "");
  });

  test("administrator menja podatke, ostala polja ostaju", async () => {
    const res = await request(app)
      .put("/api/settings/facility")
      .set(authHeader(admin))
      .send({ name: "  Dom Sunce  ", city: "Novi Sad", logo: PNG });
    assert.equal(res.status, 200);
    assert.equal(res.body.facility.name, "Dom Sunce");
    assert.equal(res.body.facility.subtitle, "Dom za stara lica");

    await request(app).put("/api/settings/facility").set(authHeader(admin)).send({ phone: "021 123 456" });
    const after = await request(app).get("/api/settings/facility");
    assert.equal(after.body.facility.name, "Dom Sunce");
    assert.equal(after.body.facility.city, "Novi Sad");
    assert.equal(after.body.facility.phone, "021 123 456");
    assert.equal(after.body.facility.logo, PNG);
  });

  test("samo administrator sme da menja", async () => {
    for (const user of [mainNurse, nurse]) {
      const res = await request(app).put("/api/settings/facility").set(authHeader(user)).send({ name: "X" });
      assert.equal(res.status, 403);
    }
    const anon = await request(app).put("/api/settings/facility").send({ name: "X" });
    assert.equal(anon.status, 401);
  });

  test("odbija neispravne vrednosti", async () => {
    const put = (body: object) => request(app).put("/api/settings/facility").set(authHeader(admin)).send(body);
    assert.equal((await put({ name: "   " })).status, 400);
    assert.equal((await put({ email: "nije-mejl" })).status, 400);
    assert.equal((await put({ name: 5 })).status, 400);
    assert.equal((await put({ logo: "data:image/svg+xml;base64,PHN2Zz4=" })).status, 400, "SVG može da nosi skriptu");
    assert.equal((await put({ logo: `data:image/png;base64,${"A".repeat(800_000)}` })).status, 400);
  });

  test("logo do ~700 KB prolazi kroz ograničenje tela zahteva", async () => {
    const big = `data:image/png;base64,${"A".repeat(600_000)}`;
    const res = await request(app).put("/api/settings/facility").set(authHeader(admin)).send({ logo: big });
    assert.equal(res.status, 200);
  });
});

describe("kursna lista", () => {
  test("medicinska sestra ne može da menja kurs", async () => {
    const res = await request(app).put("/api/exchange-rates").set(authHeader(nurse)).send({ lowerExchangeRate: 1 });
    assert.equal(res.status, 403);
  });

  test("uprava menja kurs, neispravan broj se odbija", async () => {
    const ok = await request(app)
      .put("/api/exchange-rates")
      .set(authHeader(mainNurse))
      .send({ lowerExchangeRate: 116.5, middleExchangeRate: 117.2 });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.rates, { lower: 116.5, middle: 117.2 });

    const bad = await request(app).put("/api/exchange-rates").set(authHeader(admin)).send({ lowerExchangeRate: "abc" });
    assert.equal(bad.status, 400);
  });

  test("izmena ustanove ne dira kurs", async () => {
    await request(app).put("/api/exchange-rates").set(authHeader(admin)).send({ lowerExchangeRate: 116.5, middleExchangeRate: 117.2 });
    await request(app).put("/api/settings/facility").set(authHeader(admin)).send({ name: "Dom Sunce" });
    const rates = await request(app).get("/api/exchange-rates").set(authHeader(nurse));
    assert.deepEqual(rates.body.rates, { lower: 116.5, middle: 117.2 });
  });
});
