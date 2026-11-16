// Obrasci postupka smeštaja: podaci iz obrazaca u kartonu, stručni dokumenti po obrascima
// (prijemna procena, anamneza, procena, skala podrške, plan, ponovni pregled) i podaci za popunu.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import SocialProfile from "../../models/SocialProfile.js";
import { levelFor, scaleSummary, SCALE_ITEMS } from "../../services/social/supportScale.js";
import { genderWords } from "../../services/social/formFields.js";
import { authHeader, createPatient, createUser, DAY_MS, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let social: UserDoc;
let nurse: UserDoc;
let patient: Awaited<ReturnType<typeof createPatient>>;
beforeEach(async () => {
  social = await createUser("social-worker");
  nurse = await createUser("nurse");
  patient = await createPatient({ name: "Milica", lastName: "Jovanović", admissionDate: new Date(Date.now() - 3 * DAY_MS) });
});

const as = (user: UserDoc) => ({
  get: (url: string) => request(app).get(url).set(authHeader(user)),
  post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(user)).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set(authHeader(user)).send(body),
});

describe("skala podrške", () => {
  test("zbirovi po oblastima i stepen iz proseka stanja na prijemu", () => {
    assert.equal(levelFor(0), 0);
    // Veća zavisnost (ocena 4) = niži stepen (I = najviše podrške)
    assert.equal(levelFor(1), 4);
    assert.equal(levelFor(1.75), 4);
    assert.equal(levelFor(2.5), 3);
    assert.equal(levelFor(3), 2);
    assert.equal(levelFor(4), 1);
    const all = (now: number, expected: number) => Object.fromEntries(SCALE_ITEMS.map((k) => [k, { now, expected }]));
    const s = scaleSummary(all(3, 2));
    assert.equal(s.totalNow, 75);
    assert.equal(s.totalExpected, 50);
    assert.equal(s.groups.find((g) => g.key === "daily")!.now, 18);
    assert.equal(s.level, 2);
    assert.equal(scaleSummary({}).level, 0);
  });

  test("rod reči za korisnika i potpisnika", () => {
    assert.equal(genderWords("k", "Ž").k_rodjen, "rođena");
    assert.equal(genderWords("k", "M").K_rodjen, "Rođen");
    assert.equal(genderWords("p", "").p_saglasan, "saglasan-a", "bez pola ostaje kao u obrascu");
  });
});

describe("karton: podaci iz obrazaca", () => {
  test("podnosilac, poreklo, ugovor i osnov prestanka se čuvaju i proveravaju", async () => {
    const res = await as(social).patch(`/api/social/profile/${patient._id}`, {
      profile: {
        sex: "Ž",
        fatherName: "Jovanović Marko",
        motherName: "Jovanović Ana",
        motherMaidenName: "Petrović",
        maidenName: "Ilić",
        spouse: { name: "Jovanović Petar", address: "Beograd" },
        requestDate: "2026-09-01",
        payerNote: "svojom penzijom + sin",
        applicant: { kind: "relative", name: "Stevan Jovanović", relation: "sin", sex: "M", idCardNumber: "012345678" },
        contract: { roomType: "double", categories: [1, 7, 7, 99], priceEUR: "900" },
        dischargeReason: 6,
      },
    });
    assert.equal(res.status, 200, res.body.message);
    const p = res.body.profile;
    assert.equal(p.applicant.name, "Stevan Jovanović");
    assert.deepEqual(p.contract.categories, [1, 7], "bez duplikata i nepostojećih kategorija");
    assert.equal(p.contract.priceEUR, 900);
    assert.equal((await as(social).patch(`/api/social/profile/${patient._id}`, { profile: { applicant: { kind: "x" } } })).status, 400);
    assert.equal((await as(social).patch(`/api/social/profile/${patient._id}`, { profile: { dischargeReason: 9 } })).status, 400);
    assert.equal((await as(social).patch(`/api/social/profile/${patient._id}`, { profile: { applicant: { jmbg: "123" } } })).status, 400);
  });

  test("podaci za obrasce: identitet, podnosilac, rod, oznake i stručni dokumenti", async () => {
    await as(social).patch(`/api/social/profile/${patient._id}`, {
      patient: { dateOfBirth: "1947-08-07" },
      profile: {
        sex: "Ž",
        parentName: "Marko",
        requestDate: "2026-09-01",
        applicant: { kind: "relative", name: "Stevan Jovanović", relation: "sin", sex: "M", idCardNumber: "012345678" },
        contract: { roomType: "single", categories: [3] },
        dischargeReason: 2,
      },
    });
    const scale = Object.fromEntries(SCALE_ITEMS.map((k) => [k, { now: 2, expected: 1 }]));
    const created = await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "support_scale", date: "2026-09-05", scale, sections: { observations: "Saradljiva." } });
    assert.equal(created.status, 201, created.body.message);
    assert.equal(created.body.document.supportLevel, 3, "stepen se računa iz ocena");
    const fin = await as(social).post(`/api/social/documents/${created.body.document._id}/finalize`);
    assert.equal(fin.status, 200, fin.body.message);
    assert.equal((await SocialProfile.findOne({ patient: patient._id }))?.supportLevel, 3, "stepen prelazi u karton");

    await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "intake", date: "2026-09-02", sections: { attitude: "Saglasna.", request: "stari deo" } });

    const data = (await as(social).get(`/api/social/merge-data/${patient._id}`)).body;
    const f = data.fields;
    assert.equal(f.prezime_roditelj_ime, "Jovanović (Marko) Milica");
    assert.equal(f.ime_prezime_akuz, "Milicu Jovanović");
    assert.equal(f.ime_prezime_dat, "Milici Jovanović");
    assert.equal(f.ime_prezime_gen, "Milice Jovanović");
    assert.equal(f.godina_rodjenja, "1947.");
    assert.equal(f.datum_zahteva, "01.09.2026.");
    assert.equal(f.podnosilac, "Stevan Jovanović");
    assert.equal(f.podnosilac_lk, "012345678");
    assert.equal(f.k_rodjen, "rođena");
    assert.equal(f.p_saglasan, "saglasan", "potpisnik je sin");
    assert.equal(f.stepen, "III");
    assert.equal(f.sk_toilet_ts, "2");
    assert.equal(f.sk_ukupno_ts, "50");
    assert.equal(f.sk_stepen, "III");
    assert.equal(f.sk_observations, "Saradljiva.");
    assert.equal(f.pp_attitude, "Saglasna.");
    assert.equal(f.pp_request, "stari deo", "raniji deo se ne gubi");
    assert.equal(data.flags.soba_1, true);
    assert.equal(data.flags.kat_3, true);
    assert.equal(data.flags.kat_4, false);
    assert.equal(data.flags.prestanak_2, true);
    assert.equal(data.flags.podnosilac_srodnik, true);
  });

  test("korisnik sam podnosi zahtev: potpisnik su njegovi podaci", async () => {
    await as(social).patch(`/api/social/profile/${patient._id}`, { profile: { sex: "Ž", idCardNumber: "999", applicant: { kind: "self" } } });
    const f = (await as(social).get(`/api/social/merge-data/${patient._id}`)).body.fields;
    assert.equal(f.podnosilac, "Milica Jovanović");
    assert.equal(f.podnosilac_lk, "999");
    assert.equal(f.p_saglasan, "saglasna");
  });

  test("skala: ocene van 1–4 se odbijaju; zaključenje bez ocena nije moguće; sestra nema pristup", async () => {
    const bad = await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "support_scale", scale: { toilet: { now: 7 } } });
    assert.equal(bad.status, 400);
    const empty = await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "support_scale" });
    assert.equal((await as(social).post(`/api/social/documents/${empty.body.document._id}/finalize`)).status, 400);
    assert.equal((await as(nurse).get(`/api/social/merge-data/${patient._id}`)).status, 403);
  });
});
