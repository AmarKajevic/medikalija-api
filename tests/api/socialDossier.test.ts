// Socijalni dosije: lični podaci (JMBG), procene i individualni plan, rokovi po Pravilniku o standardima.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import { isValidJmbg } from "../../controllers/socialDossierController.js";
import { authHeader, createPatient, createUser, DAY_MS, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

/** Ispravan JMBG od prvih 12 cifara (dodaje kontrolnu cifru) */
function jmbgFrom(first12: string) {
  const d = [...first12].map(Number);
  const sum = [7, 6, 5, 4, 3, 2].reduce((s, k, i) => s + k * (d[i]! + d[i + 6]!), 0);
  const m = 11 - (sum % 11);
  return first12 + String(m > 9 ? 0 : m);
}

let social: UserDoc;
let admin: UserDoc;
let doctor: UserDoc;
let nurse: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;

beforeEach(async () => {
  social = await createUser("social-worker");
  admin = await createUser("admin");
  doctor = await createUser("doctor");
  nurse = await createUser("nurse");
  patient = await createPatient({ admissionDate: new Date(Date.now() - 3 * DAY_MS) });
});

const as = (user: UserDoc) => ({
  get: (url: string) => request(app).get(url).set(authHeader(user)),
  put: (url: string, body: object) => request(app).put(url).set(authHeader(user)).send(body),
  post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(user)).send(body),
  del: (url: string) => request(app).delete(url).set(authHeader(user)),
});

describe("JMBG", () => {
  test("13 cifara sa ispravnom kontrolnom cifrom", () => {
    const ok = jmbgFrom("010194071001");
    assert.equal(isValidJmbg(ok), true);
    assert.equal(isValidJmbg(ok.slice(0, 12) + String((Number(ok[12]) + 1) % 10)), false);
    assert.equal(isValidJmbg("123"), false);
    assert.equal(isValidJmbg("abcdefghijklm"), false);
  });
});

describe("socijalni profil", () => {
  test("prazan dok se ne unese; čuva lične podatke, staratelja, osnov smeštaja i kontakte", async () => {
    const url = `/api/social/profile/${patient._id}`;
    const empty = await as(social).get(url);
    assert.equal(empty.status, 200);
    assert.equal(empty.body.profile, null);
    assert.equal(empty.body.patient.name, "Petar");

    const jmbg = jmbgFrom("010194071001");
    const res = await as(social).put(url, {
      jmbg: ` ${jmbg} `,
      parentName: "Milan",
      sex: "M",
      maritalStatus: "widowed",
      legalCapacity: "partial",
      guardian: { name: "Marko Petrović", relation: "sin", decisionDate: "2025-03-01" },
      placementBasis: "csr",
      csrName: "CSR Beograd",
      contacts: [{ name: "Marko Petrović", relation: "sin", phone: "064 111 222", emergency: true }, { name: "" }],
      assignedStaff: String(social._id),
    });
    assert.equal(res.status, 200, res.body.message);
    const p = res.body.profile;
    assert.equal(p.jmbg, jmbg);
    assert.equal(p.guardian.decisionDate.slice(0, 10), "2025-03-01");
    assert.equal(p.contacts.length, 1, "kontakt bez imena se ne čuva");
    assert.equal(p.assignedStaff.role, "social-worker");

    // Doktor čita, ne menja; sestra nema pristup
    assert.equal((await as(doctor).get(url)).body.profile.jmbg, jmbg);
    assert.equal((await as(doctor).put(url, { parentName: "X" })).status, 403);
    assert.equal((await as(nurse).get(url)).status, 403);
  });

  test("lista osoblja za zaduženog zaposlenog: samo ime, prezime i uloga, bez suspendovanih", async () => {
    await createUser("nurse", { name: "Ukinuta", status: "suspended" });
    const res = await as(social).get("/api/social/staff");
    assert.equal(res.status, 200, res.body.message);
    assert.ok(res.body.staff.some((u: { _id: string }) => u._id === String(nurse._id)));
    assert.ok(!res.body.staff.some((u: { name: string }) => u.name === "Ukinuta"));
    assert.deepEqual(Object.keys(res.body.staff[0]).sort(), ["_id", "lastName", "name", "role"]);
  });

  test("neispravni podaci → 400", async () => {
    const url = `/api/social/profile/${patient._id}`;
    assert.equal((await as(social).put(url, { jmbg: "0101940710010" })).status, 400);
    assert.equal((await as(social).put(url, { sex: "X" })).status, 400);
    assert.equal((await as(social).put(url, { contractDate: "nije datum" })).status, 400);
    assert.equal((await as(social).get(`/api/social/profile/xyz`)).status, 400);
  });
});

describe("procene i individualni plan", () => {
  test("nacrt se menja, zaključen ne; procena prenosi stepen podrške u profil", async () => {
    const created = await as(social).post("/api/social/documents", {
      patientId: String(patient._id),
      type: "assessment",
      date: "2026-11-05",
      supportLevel: 2,
      participants: "korisnik, sin Marko",
      sections: { health: "Dijabetes tip 2", risks: "Rizik od pada", unknownKey: "ne čuva se" },
    });
    assert.equal(created.status, 201, created.body.message);
    const doc = created.body.document;
    assert.equal(doc.status, "draft");
    assert.deepEqual(Object.keys(doc.sections).sort(), ["health", "risks"]);

    const updated = await as(social).put(`/api/social/documents/${doc._id}`, { date: "2026-11-05", supportLevel: 2, sections: { health: "Dijabetes tip 2, hipertenzija" } });
    assert.equal(updated.body.document.sections.health, "Dijabetes tip 2, hipertenzija");

    assert.equal((await as(doctor).post(`/api/social/documents/${doc._id}/finalize`)).status, 403);
    const fin = await as(social).post(`/api/social/documents/${doc._id}/finalize`);
    assert.equal(fin.status, 200, fin.body.message);
    assert.equal(fin.body.document.status, "final");
    assert.equal((await as(social).put(`/api/social/documents/${doc._id}`, { sections: {} })).status, 409);
    assert.equal((await as(admin).del(`/api/social/documents/${doc._id}`)).status, 409);

    const profile = await as(social).get(`/api/social/profile/${patient._id}`);
    assert.equal(profile.body.profile.supportLevel, 2);
  });

  test("plan se zaključuje tek sa ciljem i rokom za ponovni pregled; tuđi nacrt menja samo uprava", async () => {
    const plan = (
      await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "plan", date: "2026-11-10", sections: { summary: "Na osnovu procene" } })
    ).body.document;
    assert.equal((await as(social).post(`/api/social/documents/${plan._id}/finalize`)).status, 400, "bez cilja");

    const other = await createUser("social-worker");
    assert.equal((await as(other).put(`/api/social/documents/${plan._id}`, {})).status, 403);

    const withGoals = await as(admin).put(`/api/social/documents/${plan._id}`, {
      date: "2026-11-10",
      goals: [{ goal: "Uključiti u radno-okupacione aktivnosti", outcome: "2x nedeljno", responsible: "radni terapeut", due: "2027-01-10" }, { goal: "" }],
      nextReview: "2027-05-10",
    });
    assert.equal(withGoals.status, 200, withGoals.body.message);
    assert.equal(withGoals.body.document.goals.length, 1);
    assert.equal((await as(social).put(`/api/social/documents/${plan._id}`, { date: "2026-11-10", nextReview: "2026-01-01" })).status, 400, "pregled pre datuma");
    assert.equal((await as(social).post(`/api/social/documents/${plan._id}/finalize`)).status, 200);
  });
});

describe("rokovi", () => {
  test("procena 10 dana od prijema → plan 10 dana od procene → pregled po roku iz plana", async () => {
    const deadline = async () => {
      const res = await as(social).get("/api/social/deadlines");
      assert.equal(res.status, 200, res.body.message);
      return res.body.deadlines.find((d: { patient: { _id: string } }) => d.patient._id === String(patient._id));
    };
    const admitted = new Date(patient.admissionDate);
    let d = await deadline();
    assert.equal(d.kind, "assessment");
    assert.equal(new Date(d.due).getTime(), admitted.getTime() + 10 * DAY_MS);

    const create = async (body: object) => {
      const doc = (await as(social).post("/api/social/documents", { patientId: String(patient._id), ...body })).body.document;
      assert.equal((await as(social).post(`/api/social/documents/${doc._id}/finalize`)).status, 200);
    };
    await create({ type: "assessment", date: "2026-11-05", supportLevel: 3 });
    d = await deadline();
    assert.equal(d.kind, "plan");
    assert.equal(d.due.slice(0, 10), "2026-11-15");

    await create({ type: "plan", date: "2026-11-12", goals: [{ goal: "Cilj" }], nextReview: "2027-05-12" });
    d = await deadline();
    assert.equal(d.kind, "review");
    assert.equal(d.due.slice(0, 10), "2027-05-12");

    // Otpušten korisnik nema rokove
    await (await import("../../models/Patient.js")).default.updateOne({ _id: patient._id }, { dischargeDate: new Date() });
    assert.equal(await deadline(), undefined);
  });
});
