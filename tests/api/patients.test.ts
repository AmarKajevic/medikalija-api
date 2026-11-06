import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import Patient from "../../models/Patient.js";
import Specification from "../../models/Specification.js";
import { authHeader, createPatient, createUser, DAY_MS, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let nurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin");
  nurse = await createUser("nurse");
});

const validPatient = {
  name: "Milica",
  lastName: "Jovanović",
  dateOfBirth: "1938-04-12",
  admissionDate: "2026-03-15",
  address: "Novi Sad",
};

describe("POST /api/patient/addPatient", () => {
  test("datum 'YYYY-MM-DD' se čuva kao tačno taj kalendarski dan", async () => {
    const res = await request(app).post("/api/patient/addPatient").set(authHeader(admin)).send(validPatient);
    assert.equal(res.status, 201);
    const saved = must(await Patient.findById(res.body.patient._id));
    assert.equal(saved.admissionDate.toISOString(), "2026-03-15T00:00:00.000Z");
  });

  test("lokalna ponoć iz browsera (Beograd) daje isti dan", async () => {
    const res = await request(app)
      .post("/api/patient/addPatient")
      .set(authHeader(admin))
      .send({ ...validPatient, admissionDate: "2026-03-14T23:00:00.000Z" });
    assert.equal(res.status, 201);
    assert.equal(must(await Patient.findById(res.body.patient._id)).admissionDate.toISOString(), "2026-03-15T00:00:00.000Z");
  });

  test("nepostojeći datum → 400", async () => {
    const res = await request(app).post("/api/patient/addPatient").set(authHeader(admin)).send({ ...validPatient, admissionDate: "2026-02-30" });
    assert.equal(res.status, 400);
  });

  test("sestra ne može da doda pacijenta", async () => {
    const res = await request(app).post("/api/patient/addPatient").set(authHeader(nurse)).send(validPatient);
    assert.equal(res.status, 403);
  });
});

describe("PATCH /api/patient/:id/discharge", () => {
  test("medicinska sestra ne može da otpusti pacijenta", async () => {
    const patient = await createPatient();
    const res = await request(app).patch(`/api/patient/${patient._id}/discharge`).set(authHeader(nurse)).send({ dischargeDate: "2026-05-01" });
    assert.equal(res.status, 403);
    assert.equal(must(await Patient.findById(patient._id)).dischargeDate, null);
  });

  test("otpust pre prijema → 400", async () => {
    const patient = await createPatient({ admissionDate: new Date("2026-05-10T00:00:00Z") });
    const res = await request(app).patch(`/api/patient/${patient._id}/discharge`).set(authHeader(admin)).send({ dischargeDate: "2026-05-01" });
    assert.equal(res.status, 400);
    assert.equal(must(await Patient.findById(patient._id)).dischargeDate, null);
  });

  test("zatvara specifikaciju na dan otpusta i deaktivira je", async () => {
    const admission = new Date(Date.UTC(2026, 0, 1));
    const patient = await createPatient({ admissionDate: admission });
    const spec = await Specification.create({
      patientId: patient._id,
      startDate: admission,
      endDate: new Date(admission.getTime() + 29 * DAY_MS),
      isActive: true,
    });

    const res = await request(app).patch(`/api/patient/${patient._id}/discharge`).set(authHeader(admin)).send({ dischargeDate: "2026-01-20" });

    assert.equal(res.status, 200);
    const closed = must(await Specification.findById(spec._id));
    assert.equal(closed.endDate.toISOString(), "2026-01-20T00:00:00.000Z");
    assert.equal(closed.isActive, false);
  });

  test("neispravan datum → 400", async () => {
    const patient = await createPatient();
    const res = await request(app).patch(`/api/patient/${patient._id}/discharge`).set(authHeader(admin)).send({ dischargeDate: "nije datum" });
    assert.equal(res.status, 400);
  });
});

describe("dijagnoze", () => {
  test("nepostojeći pacijent → 404 (ranije pad servera)", async () => {
    const res = await request(app)
      .post("/api/diagnosis/addDiagnosis")
      .set(authHeader(nurse))
      .send({ patientId: "64b000000000000000000000", description: "Test" });
    assert.equal(res.status, 404);
  });
});


describe("učinak rada (beleške sestara)", () => {
  test("filter po periodu i autor sa prezimenom", async () => {
    const patient = await createPatient();
    const post = (description: string) =>
      request(app).post("/api/diagnosis/addDiagnosis").set(authHeader(nurse)).send({ patientId: String(patient._id), description });
    assert.equal((await post("Previjanje rane")).status, 201);
    await post("Merenje pritiska");
    const Diagnosis = (await import("../../models/Diagnosis.js")).default;
    // createdAt je u Mongoose-u nepromenljiv — datum se menja direktno u kolekciji
    await Diagnosis.collection.updateOne({ description: "Previjanje rane" }, { $set: { createdAt: new Date("2026-01-05T10:00:00Z") } });

    const all = await request(app).get(`/api/diagnosis/${patient._id}`).set(authHeader(admin));
    assert.equal(all.body.diagnosis.length, 2);
    assert.equal(all.body.diagnosis[0].createdBy.lastName, nurse.lastName);

    const january = await request(app).get(`/api/diagnosis/${patient._id}?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z`).set(authHeader(admin));
    assert.deepEqual(january.body.diagnosis.map((d: { description: string }) => d.description), ["Previjanje rane"]);
  });
});
