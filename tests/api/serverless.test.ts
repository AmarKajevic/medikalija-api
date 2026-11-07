// Regresija (produkcija 2026-11-06): na Vercelu se aplikacija poziva direktno, bez
// startServer(), pa je prvi zahtev stizao pre konekcije na bazu → 500 i CORS greška.
// Ovaj fajl NAMERNO ne koristi useTestDatabase(): baza nije povezana kad stigne zahtev.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import app from "../../app.js";

let mongo: MongoMemoryServer;
const FRONTEND = "https://medikalija-frontend.vercel.app";

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URL = mongo.getUri();
  assert.equal(mongoose.connection.readyState, 0, "test mora početi bez konekcije");
});

after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("serverless pokretanje", () => {
  test("prvi zahtev sam uspostavlja konekciju (nema 500)", async () => {
    const res = await request(app).post("/api/auth/login").set("Origin", FRONTEND).send({ name: "Nema", lastName: "Takvog", password: "x" });
    // 401 = baza je odgovorila (nepostojeći korisnik); 500/503 bi značilo da konekcija nije uspostavljena
    assert.equal(res.status, 401, `očekivan 401 (nepostojeći korisnik), dobijeno ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(mongoose.connection.readyState, 1);
    assert.equal(res.headers["access-control-allow-origin"], FRONTEND);
  });

  test("istovremeni prvi zahtevi dele jednu konekciju", async () => {
    await mongoose.disconnect();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(app).post("/api/auth/login").send({ name: "A", lastName: "B", password: "x" }))
    );
    assert.deepEqual(results.map((r) => r.status), [401, 401, 401, 401, 401]);
  });

  test("CORS preflight za frontend prolazi bez baze", async () => {
    const res = await request(app)
      .options("/api/auth/login")
      .set("Origin", FRONTEND)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], FRONTEND);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("nepoznat origin ne dobija CORS dozvolu", async () => {
    const res = await request(app).options("/api/auth/login").set("Origin", "https://napadac.example").set("Access-Control-Request-Method", "POST");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});
