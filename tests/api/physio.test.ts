// Fizioterapeut: redovna fizikalna terapija se beleži, vanredna čeka da uprava odredi
// cenu i odobri je; pristup samo pacijentima, unosu terapije i kalendaru.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import { authHeader, createPatient, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let physio: UserDoc;
let nurse: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  admin = await createUser("admin");
  physio = await createUser("physiotherapist");
  nurse = await createUser("nurse");
  patient = await createPatient();
});

const as = (user: UserDoc) => ({
  get: (url: string) => request(app).get(url).set(authHeader(user)),
  post: (url: string, body: object) => request(app).post(url).set(authHeader(user)).send(body),
});
const log = (user: UserDoc, entries: object[]) => as(user).post("/api/nurse-entries", { patientId: String(patient._id), entries });
const spec = async () => (await as(admin).get(`/api/specification/${patient._id}`)).body.specification;

describe("fizikalna terapija", () => {
  test("redovna se samo beleži, vanredna čeka odobrenje", async () => {
    const res = await log(physio, [
      { type: "physio", physioKind: "active" },
      { type: "physio", physioKind: "group", extra: true, note: "posle pada" },
    ]);
    assert.equal(res.status, 201, res.body.message);
    const [regular, extra] = res.body.entries;
    assert.equal(regular.status, "logged");
    assert.equal(regular.name, "Individualna aktivna fizikalna terapija");
    assert.equal(extra.status, "pending");
    assert.equal(extra.name, "Grupna fizikalna terapija (vanredna)");
    assert.equal((await spec()).items.length, 0, "ništa još nije naplaćeno");

    const mine = (await as(physio).get("/api/nurse-entries?mine=1&type=physio")).body.entries;
    assert.equal(mine.length, 2);
  });

  test("uprava određuje cenu i odobrava; tek tada ulazi u specifikaciju", async () => {
    const [entry] = (await log(physio, [{ type: "physio", physioKind: "passive", extra: true }])).body.entries;
    const noPrice = await as(admin).post(`/api/nurse-entries/${entry._id}/accept`, {});
    assert.equal(noPrice.status, 400);
    assert.match(noPrice.body.message, /cenu/);

    const ok = await as(admin).post(`/api/nurse-entries/${entry._id}/accept`, { price: 1500 });
    assert.equal(ok.status, 200, ok.body.message);
    const item = must((await spec()).items.find((i: { category?: string }) => i.category === "physio"));
    assert.equal(item.name, "Individualna pasivna fizikalna terapija (vanredna)");
    assert.equal(item.price, 1500);

    // Grupno odobravanje prosleđuje cenu po unosu
    const [second] = (await log(physio, [{ type: "physio", physioKind: "group", extra: true }])).body.entries;
    const bulk = await as(admin).post("/api/nurse-entries/accept", { items: [{ id: second._id, price: 800 }] });
    assert.equal(bulk.status, 200, bulk.body.message);
    assert.equal((await spec()).totalPrice, 2300);
  });

  test("ko šta sme: sestra ne unosi terapiju, fizioterapeut ne unosi lekove i ne vidi specifikacije", async () => {
    assert.equal((await log(nurse, [{ type: "physio", physioKind: "active" }])).status, 403);
    assert.equal((await log(physio, [{ type: "care", itemId: "64b000000000000000000000" }])).status, 403);
    assert.equal((await log(physio, [{ type: "physio", physioKind: "masaža" }])).status, 400);
    assert.equal((await as(physio).get(`/api/specification/${patient._id}`)).status, 403);
    assert.equal((await as(physio).get("/api/medicine")).status, 403);
    assert.equal((await as(physio).get("/api/patient")).status, 200);
    assert.equal((await as(physio).post("/api/nurse-entries/accept", { items: [] })).status, 403, "ne odobrava");
  });
});
