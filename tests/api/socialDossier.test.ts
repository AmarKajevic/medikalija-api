// Socijalni dosije: lični podaci (JMBG), novi korisnik, procene i individualni plan, rokovi,
// podaci za Word šablone, šabloni i trajno brisanje korisnika.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../app.js";
import { isValidJmbg } from "../../controllers/socialDossierController.js";
import { jmbgInfo } from "../../services/social/jmbg.js";
import Patient from "../../models/Patient.js";
import SocialProfile from "../../models/SocialProfile.js";
import SocialNote from "../../models/SocialNote.js";
import AuditLog from "../../models/AuditLog.js";
import { authHeader, createPatient, createUser, DAY_MS, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

/** Ispravan JMBG od prvih 12 cifara (dodaje kontrolnu cifru) */
function jmbgFrom(first12: string) {
  const d = [...first12].map(Number);
  const sum = [7, 6, 5, 4, 3, 2].reduce((s, k, i) => s + k * (d[i]! + d[i + 6]!), 0);
  const m = 11 - (sum % 11);
  return first12 + String(m > 9 ? 0 : m);
}
// Petar, rođen 01.01.1940. (muški: redni broj 001)
const PETAR_JMBG = jmbgFrom("010194071001");

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
  patch: (url: string, body: object) => request(app).patch(url).set(authHeader(user)).send(body),
  put: (url: string, body: object) => request(app).put(url).set(authHeader(user)).send(body),
  post: (url: string, body: object = {}) => request(app).post(url).set(authHeader(user)).send(body),
  del: (url: string, body: object = {}) => request(app).delete(url).set(authHeader(user)).send(body),
});
const profileUrl = () => `/api/social/profile/${patient._id}`;

describe("JMBG", () => {
  test("kontrolna cifra, datum rođenja i pol", () => {
    assert.equal(isValidJmbg(PETAR_JMBG), true);
    assert.equal(isValidJmbg(PETAR_JMBG.slice(0, 12) + String((Number(PETAR_JMBG[12]) + 1) % 10)), false);
    assert.equal(isValidJmbg("123"), false);
    const info = jmbgInfo(PETAR_JMBG)!;
    assert.equal(info.birthDate.toISOString().slice(0, 10), "1940-01-01");
    assert.equal(info.sex, "M");
    assert.equal(jmbgInfo(jmbgFrom("150395571550"))!.sex, "Ž");
    assert.equal(jmbgInfo(jmbgFrom("150300071550"))!.birthDate.getUTCFullYear(), 2000);
  });
});

describe("socijalni profil", () => {
  test("čuva se samo poslato: delimičan unos ne briše ranije unete podatke", async () => {
    const first = await as(social).patch(profileUrl(), { profile: { parentName: "Milan", placementBasis: "csr", csrName: "CSR Beograd" } });
    assert.equal(first.status, 200, first.body.message);
    const second = await as(social).patch(profileUrl(), { profile: { education: "srednja škola" } });
    assert.equal(second.body.profile.parentName, "Milan");
    assert.equal(second.body.profile.csrName, "CSR Beograd");
    assert.equal(second.body.profile.education, "srednja škola");
  });

  test("osnovni podaci menjaju se na jednom mestu (Patient); kontakti postaju kontakt osoba", async () => {
    const res = await as(social).patch(profileUrl(), {
      patient: { name: "Pera", address: "Nova adresa 1" },
      profile: { contacts: [{ name: "Ana Petrović", relation: "ćerka", phone: "060 1" }, { name: "Marko Petrović", relation: "sin", phone: "064 2", emergency: true }, { name: "" }] },
    });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.profile.contacts.length, 2, "kontakt bez imena se ne čuva");
    const p = await Patient.findById(patient._id).lean();
    assert.equal(p!.name, "Pera");
    assert.equal(p!.address, "Nova adresa 1");
    assert.equal(p!.contactPerson, "Marko Petrović, sin, 064 2", "hitni kontakt je glavni kontakt");
    assert.equal((await as(social).patch(profileUrl(), { patient: { name: " " } })).status, 400);
  });

  test("JMBG dopunjuje datum rođenja i pol; ne sme se razlikovati od unetog datuma; ne sme se ponoviti", async () => {
    await Patient.updateOne({ _id: patient._id }, { $set: { dateOfBirth: null } });
    const res = await as(social).patch(profileUrl(), { profile: { jmbg: ` ${PETAR_JMBG} ` } });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(res.body.profile.jmbg, PETAR_JMBG);
    assert.equal(res.body.profile.sex, "M");
    assert.equal(res.body.patient.dateOfBirth.slice(0, 10), "1940-01-01");

    const wrongDay = await as(social).patch(profileUrl(), { patient: { dateOfBirth: "1941-05-05" } });
    assert.equal(wrongDay.status, 400);
    assert.match(wrongDay.body.message, /ne slaže sa JMBG/);

    const other = await createPatient({ name: "Drugi" });
    const dup = await as(social).patch(`/api/social/profile/${other._id}`, { profile: { jmbg: PETAR_JMBG } });
    assert.equal(dup.status, 409);
    assert.match(dup.body.message, /već unet kod korisnika Petar Petrović/);
    assert.equal((await as(social).patch(profileUrl(), { profile: { jmbg: "0101940710010" } })).status, 400, "neispravna kontrolna cifra");
  });

  test("istovremena izmena: zastareli updatedAt → 409, ništa se ne prepisuje", async () => {
    const saved = (await as(social).patch(profileUrl(), { profile: { parentName: "Milan" } })).body.profile;
    await as(admin).patch(profileUrl(), { profile: { parentName: "Mile" }, expectedUpdatedAt: saved.updatedAt });
    const stale = await as(social).patch(profileUrl(), { profile: { parentName: "Milanče" }, expectedUpdatedAt: saved.updatedAt });
    assert.equal(stale.status, 409);
    assert.equal((await SocialProfile.findOne({ patient: patient._id }))!.parentName, "Mile");
  });

  test("pristup: doktor čita, sestra nema pristup; svaka izmena ide u zapisnik (bez vrednosti)", async () => {
    await as(social).patch(profileUrl(), { profile: { jmbg: PETAR_JMBG } });
    assert.equal((await as(doctor).get(profileUrl())).body.profile.jmbg, PETAR_JMBG);
    assert.equal((await as(doctor).patch(profileUrl(), { profile: { parentName: "X" } })).status, 403);
    assert.equal((await as(nurse).get(profileUrl())).status, 403);
    const history = (await as(social).get(`/api/social/history/${patient._id}`)).body.history;
    assert.equal(history[0].action, "profile.update");
    assert.ok(history[0].fields.includes("jmbg"));
    assert.ok(!JSON.stringify(history).includes(PETAR_JMBG), "zapisnik ne sadrži vrednosti");
  });

  test("lista osoblja: samo ime, prezime i uloga, bez suspendovanih", async () => {
    await createUser("nurse", { name: "Ukinuta", status: "suspended" });
    const res = await as(social).get("/api/social/staff");
    assert.equal(res.status, 200, res.body.message);
    assert.ok(!res.body.staff.some((u: { name: string }) => u.name === "Ukinuta"));
    assert.deepEqual(Object.keys(res.body.staff[0]).sort(), ["_id", "lastName", "name", "role"]);
  });
});

describe("novi korisnik (socijalni radnik)", () => {
  test("osnovni podaci: dovoljni su ime, prezime i datum prijema", async () => {
    const res = await as(social).post("/api/social/residents", { patient: { name: "Mira", lastName: "Mirić", admissionDate: "2026-11-01" } });
    assert.equal(res.status, 201, res.body.message);
    assert.equal(res.body.patient.dateOfBirth, null);
    assert.equal(res.body.patient.address, "");
    assert.equal((await as(social).post("/api/social/residents", { patient: { name: "Bez", lastName: "Datuma" } })).status, 400);
  });

  test("detaljni podaci: korisnik i profil zajedno; ako profil ne prođe, korisnik se ne pravi", async () => {
    const ok = await as(social).post("/api/social/residents", {
      patient: { name: "Petar", lastName: "Novi", admissionDate: "2026-11-01", address: "Beograd" },
      profile: { jmbg: PETAR_JMBG, legalCapacity: "full", contacts: [{ name: "Sin", phone: "064" }] },
    });
    assert.equal(ok.status, 201, ok.body.message);
    assert.equal(ok.body.profile.jmbg, PETAR_JMBG);
    assert.equal(ok.body.patient.dateOfBirth.slice(0, 10), "1940-01-01", "datum rođenja iz JMBG-a");

    const before = await Patient.countDocuments();
    const bad = await as(social).post("/api/social/residents", { patient: { name: "Isti", lastName: "JMBG", admissionDate: "2026-11-01" }, profile: { jmbg: PETAR_JMBG } });
    assert.equal(bad.status, 409);
    assert.equal(await Patient.countDocuments(), before, "korisnik nije ostao upola sačuvan");
    assert.equal((await as(nurse).post("/api/social/residents", { patient: { name: "A", lastName: "B", admissionDate: "2026-11-01" } })).status, 403);
  });
});

describe("procene i individualni plan", () => {
  test("nacrt se menja, zaključen ne; procena prenosi stepen podrške u profil", async () => {
    const created = await as(social).post("/api/social/documents", {
      patientId: String(patient._id),
      type: "assessment",
      date: "2026-11-05",
      supportLevel: 2,
      sections: { health: "Dijabetes tip 2", unknownKey: "ne čuva se" },
    });
    assert.equal(created.status, 201, created.body.message);
    const doc = created.body.document;
    assert.deepEqual(Object.keys(doc.sections), ["health"]);

    const stale = await as(social).put(`/api/social/documents/${doc._id}`, { date: "2026-11-05", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" });
    assert.equal(stale.status, 409, "nacrt promenjen u međuvremenu");

    assert.equal((await as(doctor).post(`/api/social/documents/${doc._id}/finalize`)).status, 403);
    assert.equal((await as(social).post(`/api/social/documents/${doc._id}/finalize`)).status, 200);
    assert.equal((await as(social).put(`/api/social/documents/${doc._id}`, { sections: {} })).status, 409);
    assert.equal((await as(admin).del(`/api/social/documents/${doc._id}`)).status, 409);
    assert.equal((await as(social).get(profileUrl())).body.profile.supportLevel, 2);
  });

  test("plan se zaključuje tek sa ciljem i rokom za ponovni pregled; tuđi nacrt menja samo uprava", async () => {
    const plan = (await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "plan", date: "2026-11-10" })).body.document;
    assert.equal((await as(social).post(`/api/social/documents/${plan._id}/finalize`)).status, 400, "bez cilja");
    const other = await createUser("social-worker");
    assert.equal((await as(other).put(`/api/social/documents/${plan._id}`, {})).status, 403);
    const withGoals = await as(admin).put(`/api/social/documents/${plan._id}`, { date: "2026-11-10", goals: [{ goal: "Šetnja", due: "2027-01-10" }, { goal: "" }], nextReview: "2027-05-10" });
    assert.equal(withGoals.body.document.goals.length, 1);
    assert.equal((await as(social).post(`/api/social/documents/${plan._id}/finalize`)).status, 200);
  });
});

describe("rokovi", () => {
  test("procena 10 dana od prijema → plan 10 dana od procene → pregled po roku iz plana", async () => {
    const deadline = async () => (await as(social).get("/api/social/deadlines")).body.deadlines.find((d: { patient: { _id: string } }) => d.patient._id === String(patient._id));
    let d = await deadline();
    assert.equal(d.kind, "assessment");
    assert.equal(new Date(d.due).getTime(), new Date(patient.admissionDate).getTime() + 10 * DAY_MS);
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
    await Patient.updateOne({ _id: patient._id }, { dischargeDate: new Date() });
    assert.equal(await deadline(), undefined, "otpušten korisnik nema rokove");
  });
});

describe("Word šabloni", () => {
  // Najmanji .docx za proveru (ZIP potpis + word/document.xml)
  const fakeDocx = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.from("word/document.xml"), Buffer.alloc(32)]).toString("base64");

  test("katalog polja i podaci korisnika: uneto jednom, popunjava se svuda", async () => {
    await as(social).patch(profileUrl(), {
      profile: {
        jmbg: PETAR_JMBG,
        legalCapacity: "partial",
        guardian: { name: "Marko Petrović", phone: "064 2" },
        contacts: [{ name: "Marko Petrović", relation: "sin", phone: "064 2" }],
        dossierNumber: "SR-2026/087",
        accommodation: "Odeljenje B, soba 214",
        placementBasis: "contract",
        contractNumber: "112/2026",
        birthPlace: "Kraljevo",
      },
    });
    await SocialNote.create({ patient: patient._id, author: social._id, date: new Date("2026-03-14T12:00:00Z"), title: "Prijem", text: "Prijem korisnika u pratnji sina." });
    const assessment = (await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "assessment", date: "2026-03-20", sections: { socialHistory: "Rođen u Kraljevu.", conclusion: "Dobro adaptiran." } })).body.document;
    await as(social).post(`/api/social/documents/${assessment._id}/finalize`);
    const plan = (await as(social).post("/api/social/documents", { patientId: String(patient._id), type: "plan", date: "2026-03-25", goals: [{ area: "Adaptacija", goal: "Oseća se sigurno" }], nextReview: "2026-09-25" })).body.document;
    await as(social).post(`/api/social/documents/${plan._id}/finalize`);
    const fields = (await as(social).get("/api/social/merge-fields")).body;
    assert.ok(fields.fields.some((f: { key: string }) => f.key === "jmbg"));
    assert.ok(fields.lists.some((l: { key: string }) => l.key === "kontakti"));

    const data = (await as(social).get(`/api/social/merge-data/${patient._id}`)).body;
    assert.equal(data.fields.ime_prezime, "Petar Petrović");
    assert.equal(data.fields.jmbg, PETAR_JMBG);
    assert.equal(data.fields.datum_rodjenja, "01.01.1940.");
    assert.equal(data.fields.staratelj, "Marko Petrović");
    assert.equal(data.fields.poslovna_sposobnost, "delimično lišen poslovne sposobnosti");
    assert.deepEqual(data.lists.kontakti[0], { kontakt_ime: "Marko Petrović", kontakt_srodstvo: "sin", kontakt_telefon: "064 2", kontakt_email: "", kontakt_adresa: "", kontakt_napomena: "" });
    assert.equal(data.fields.broj_dosijea, "SR-2026/087");
    await as(social).patch(profileUrl(), { profile: { maritalStatus: "widowed" } });
    assert.equal((await as(social).get(`/api/social/merge-data/${patient._id}`)).body.fields.bracni_status, "udovac", "oblik po polu iz JMBG-a");
    assert.equal(data.fields.smestaj, "Odeljenje B, soba 214");
    assert.equal(data.fields.datum_i_mesto_rodjenja, "01.01.1940., Kraljevo");
    assert.equal(data.fields.osnov_smestaja_opis, "Ugovor o smeštaju br. 112/2026");
    assert.equal(data.fields.anamneza, "Rođen u Kraljevu.");
    assert.equal(data.fields.zakljucak, "Dobro adaptiran.");
    assert.equal(data.fields.socijalni_radnik, `${social.name} ${social.lastName}`, "ko pravi dokument");
    assert.deepEqual(data.lists.ciljevi[0], { rb: "1", oblast: "Adaptacija", cilj: "Oseća se sigurno", ishod: "", aktivnosti: "", odgovorni: "", rok: "" });
    assert.deepEqual(data.lists.beleske, [{ beleska_datum: "14.03.2026.", beleska_naslov: "Prijem", beleska: "Prijem korisnika u pratnji sina." }]);
    // Svaka katalogizovana vrednost postoji u podacima (nema polja bez izvora)
    for (const f of fields.fields as Array<{ key: string }>) assert.ok(f.key in data.fields, f.key);
  });

  test("socijalni radnik postavlja, menja i briše .docx šablon; ne-Word fajl se odbija", async () => {
    const up = await as(social).post("/api/social/templates", { name: "Ugovor o smeštaju", fileName: "ugovor.docx", data: fakeDocx });
    assert.equal(up.status, 201, up.body.message);
    assert.equal(up.body.template.data, undefined, "fajl se ne vraća u listi");

    const file = await as(social).get(`/api/social/templates/${up.body.template._id}/file`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(file.status, 200);
    assert.equal((file.body as Buffer).toString("base64"), fakeDocx);

    assert.equal((await as(social).put(`/api/social/templates/${up.body.template._id}`, { name: "Ugovor 2026" })).body.template.name, "Ugovor 2026");
    assert.equal((await as(social).post("/api/social/templates", { fileName: "slika.docx", data: Buffer.from("nije zip").toString("base64") })).status, 400);
    assert.equal((await as(social).post("/api/social/templates", { fileName: "stari.doc", data: fakeDocx })).status, 400);
    assert.equal((await as(doctor).post("/api/social/templates", { fileName: "a.docx", data: fakeDocx })).status, 403);
    assert.equal((await as(social).del(`/api/social/templates/${up.body.template._id}`)).status, 200);
    assert.equal((await as(social).get("/api/social/templates")).body.templates.length, 0);
  });
});

describe("trajno brisanje korisnika (admin)", () => {
  test("samo admin, uz ukucano ime i prezime; briše sve podatke korisnika", async () => {
    await as(social).patch(profileUrl(), { profile: { jmbg: PETAR_JMBG } });
    await SocialNote.create({ patient: patient._id, author: social._id, date: new Date(), text: "beleška" });
    const url = `/api/patient/${patient._id}?permanent=true`;

    // Obično brisanje odbija korisnika sa dokumentacijom
    assert.equal((await as(admin).del(`/api/patient/${patient._id}`)).status, 409);
    assert.equal((await request(app).delete(url).set(authHeader(await createUser("main-nurse"))).send({ confirmName: "Petar Petrović" })).status, 403);
    assert.equal((await as(admin).del(url, { confirmName: "Petar" })).status, 400);

    const res = await as(admin).del(url, { confirmName: "  petar   petrović " });
    assert.equal(res.status, 200, res.body.message);
    assert.equal(await Patient.countDocuments({ _id: patient._id }), 0);
    assert.equal(await SocialProfile.countDocuments({ patient: patient._id }), 0);
    assert.equal(await SocialNote.countDocuments({ patient: patient._id }), 0);
    const log = await AuditLog.findOne({ action: "patient.purge" }).lean();
    assert.equal(log!.summary, "Trajno obrisan korisnik P. P. sa svim podacima", "zapisnik bez punog imena");
  });
});
