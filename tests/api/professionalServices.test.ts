// Stručne usluge (cenovnik admina, dodavanje u specifikaciju) i napomene za vanstandardni smeštaj.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
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

describe("stručne usluge", () => {
  test("admin pravi cenovnik; uprava čita; sestra nema pristup", async () => {
    const a = as(admin);
    assert.equal((await a.post("/api/professional-services", { name: "Psiholog — seansa", priceRSD: 3000 })).status, 201);
    assert.equal((await a.post("/api/professional-services", { name: "Pregled kardiologa", priceRSD: 4500 })).status, 201);
    assert.equal((await a.post("/api/professional-services", { name: "PSIHOLOG — SEANSA", priceRSD: 1 })).status, 409, "isti naziv");
    assert.equal((await a.post("/api/professional-services", { name: "Bez cene" })).status, 400);

    const list = (await as(mainNurse).get("/api/professional-services")).body.services;
    assert.deepEqual(list.map((s: { name: string }) => s.name), ["Pregled kardiologa", "Psiholog — seansa"]);
    assert.equal((await as(mainNurse).post("/api/professional-services", { name: "X", priceRSD: 1 })).status, 403);
    assert.equal((await as(nurse).get("/api/professional-services")).status, 403);

    const id = list[0]._id;
    assert.equal((await a.put(`/api/professional-services/${id}`, { active: false })).body.service.active, false);
    assert.equal((await as(mainNurse).get("/api/professional-services")).body.services.length, 1, "neaktivna se ne nudi");
    assert.equal((await a.del(`/api/professional-services/${id}`)).status, 200);
  });

  test("dodavanje u specifikaciju: cena × broj puta, kategorija stručne usluge", async () => {
    const patient = await createPatient();
    const service = (await as(admin).post("/api/professional-services", { name: "Psiholog — seansa", priceRSD: 3000 })).body.service;
    const res = await as(mainNurse).post("/api/professional-services/charge", { patientId: String(patient._id), serviceId: service._id, amount: 2 });
    assert.equal(res.status, 201, res.body.message);
    const item = res.body.specification.items.find((i: { category: string }) => i.category === "professional");
    assert.equal(item.name, "Psiholog — seansa");
    assert.equal(item.amount, 2);
    assert.equal(item.price, 6000);
    assert.equal(res.body.specification.totalPrice, 6000);

    assert.equal((await as(mainNurse).post("/api/professional-services/charge", { patientId: String(patient._id), serviceId: service._id, amount: 0 })).status, 400);
    assert.equal((await as(nurse).post("/api/professional-services/charge", { patientId: String(patient._id), serviceId: service._id })).status, 403);
  });
});

describe("napomene za vanstandardni smeštaj", () => {
  test("admin pravi listu; napomena se čuva u obračunu samo uz uključen vanstandardni smeštaj", async () => {
    const a = as(admin);
    assert.equal((await a.post("/api/lodging-notes", { text: "Smeštaj od prijema do početka perioda" })).status, 201);
    assert.equal((await a.post("/api/lodging-notes", { text: "" })).status, 400);
    assert.equal((await as(mainNurse).post("/api/lodging-notes", { text: "X" })).status, 403);
    const notes = (await as(mainNurse).get("/api/lodging-notes")).body.notes;
    assert.equal(notes.length, 1);

    const patient = await createPatient();
    const spec = (await as(admin).get(`/api/specification/${patient._id}`)).body.specification;
    const save = (body: object) => as(admin).post(`/api/specification/${spec._id}/billing`, body);
    const withNote = await save({ includeEarlyLodging: true, earlyLodgingEUR: 120, earlyLodgingNote: notes[0].text });
    assert.equal(withNote.status, 200, withNote.body.message);
    assert.equal(withNote.body.specification.billing.earlyLodgingNote, "Smeštaj od prijema do početka perioda");
    const off = await save({ includeEarlyLodging: false, earlyLodgingEUR: 120, earlyLodgingNote: notes[0].text });
    assert.equal(off.body.specification.billing.earlyLodgingNote, "", "isključen smeštaj nema napomenu");
  });
});
