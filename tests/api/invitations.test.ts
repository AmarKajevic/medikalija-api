// Pristup samo po pozivu: pozivnice, Google prijava, suspendovanje, brisanje.
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcrypt";
import app from "../../app.js";
import User from "../../models/User.js";
import Token from "../../models/Token.js";
import { setGoogleVerifier } from "../../services/auth/google.js";
import { ensureUserIndexes } from "../../services/auth/indexes.js";
import { authHeader, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let admin: UserDoc;
let mainNurse: UserDoc;

beforeEach(async () => {
  admin = await createUser("admin", { email: "direktor@dom.rs", passwordHash: await bcrypt.hash("admin-lozinka-1", 4) });
  mainNurse = await createUser("main-nurse");
});
afterEach(() => setGoogleVerifier(null));

const invite = (body: object, user: UserDoc = admin) => request(app).post("/api/auth/invitations").set(authHeader(user)).send(body);
const tokenOf = (url: string) => url.split("/").pop()!;

describe("pozivnica", () => {
  test("samo admin poziva; treba e-mail ili korisničko ime", async () => {
    assert.equal((await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" }, mainNurse)).status, 403);
    assert.equal((await invite({ name: "Ana", lastName: "Anić", role: "nurse" })).status, 400);
    assert.equal((await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "Kitchen" })).status, 400, "uloga bez pristupa se ne poziva");
    const ok = await invite({ name: "Ana", lastName: "Anić", email: "ANA@dom.rs", role: "nurse" });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.user.status, "invited");
    assert.equal(ok.body.user.email, "ana@dom.rs");
    assert.equal(ok.body.invite.emailSent, false, "bez mejl servisa admin kopira link");
    assert.match(ok.body.invite.url, /\/invite\/[\w-]{40,}$/);
    assert.equal((await invite({ name: "Druga", lastName: "Ana", email: "ana@dom.rs", role: "nurse" })).status, 409);
  });

  test("prihvatanje: jaka lozinka, prijava odmah, link važi jednom", async () => {
    const { body } = await invite({ name: "Sanja", lastName: "Petrović", username: "sanja.p", role: "nurse" });
    const token = tokenOf(body.invite.url);

    const info = await request(app).get(`/api/auth/link/${token}`);
    assert.equal(info.status, 200);
    assert.equal(info.body.link.purpose, "invite");
    assert.equal(info.body.link.username, "sanja.p");
    assert.equal(info.body.link.invitedBy, `${admin.name} ${admin.lastName}`);

    assert.equal((await request(app).post(`/api/auth/link/${token}`).send({ password: "kratka" })).status, 400);
    const accepted = await request(app).post(`/api/auth/link/${token}`).send({ password: "moja-nova-lozinka" });
    assert.equal(accepted.status, 200);
    assert.ok(accepted.body.accessToken);
    assert.equal(must(await User.findOne({ username: "sanja.p" })).status, "active");

    assert.equal((await request(app).post(`/api/auth/link/${token}`).send({ password: "moja-nova-lozinka" })).status, 410);
    assert.equal((await request(app).post("/api/auth/login").send({ identifier: "sanja.p", password: "moja-nova-lozinka" })).status, 200);
  });

  test("pozvani bez lozinke ne može da se prijavi; nova pozivnica poništava staru", async () => {
    const { body } = await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" });
    assert.equal((await request(app).post("/api/auth/login").send({ identifier: "ana@dom.rs", password: "bilo-sta-123" })).status, 401);

    const again = await request(app).post(`/api/auth/users/${body.user._id}/invite`).set(authHeader(admin));
    assert.equal(again.status, 200);
    assert.equal((await request(app).get(`/api/auth/link/${tokenOf(body.invite.url)}`)).status, 410);
    assert.equal((await request(app).get(`/api/auth/link/${tokenOf(again.body.invite.url)}`)).status, 200);
  });

  test("istekao link se ne prihvata", async () => {
    const { body } = await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" });
    await User.updateOne({ _id: body.user._id }, { "link.expiresAt": new Date(Date.now() - 1000) });
    assert.equal((await request(app).post(`/api/auth/link/${tokenOf(body.invite.url)}`).send({ password: "moja-nova-lozinka" })).status, 410);
  });
});

describe("stara baza i postojeće adrese", () => {
  test("stari indeks email_1 se popravlja: više pozvanih korisničkim imenom (bez mejla)", async () => {
    // Stanje produkcijske baze pre ove verzije
    await User.collection.dropIndexes();
    await User.collection.createIndex({ email: 1 }, { unique: true, name: "email_1" });
    await ensureUserIndexes();
    assert.equal((await invite({ name: "Sanja", lastName: "P", username: "sanja.p", role: "nurse" })).status, 201);
    assert.equal((await invite({ name: "Mira", lastName: "M", username: "mira.m", role: "nurse" })).status, 201);
  });

  test("adresa suspendovanog korisnika: jasna poruka i kome pripada", async () => {
    const old = await createUser("nurse", { name: "Mira", lastName: "Mirić", email: "mira@dom.rs", status: "suspended" });
    const res = await invite({ name: "Mira", lastName: "Mirić", email: "MIRA@dom.rs", role: "nurse" });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /ukinut pristup/);
    assert.equal(res.body.existing._id, String(old._id));
    assert.equal(res.body.existing.status, "suspended");
  });

  test("povučena pozivnica oslobađa adresu", async () => {
    const { body } = await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" });
    await request(app).delete(`/api/auth/users/${body.user._id}`).set(authHeader(admin));
    assert.equal((await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" })).status, 201);
  });
});

describe("slanje linka mejlom", () => {
  test("bez mejl servisa: jasna poruka; nevažeći link se ne šalje", async () => {
    const { body } = await invite({ name: "Ana", lastName: "Anić", username: "ana.a", role: "nurse" });
    const send = (b: object) => request(app).post("/api/auth/links/send").set(authHeader(admin)).send(b);
    assert.equal((await send({ url: body.invite.url, email: "nije-mejl" })).status, 400);
    assert.equal((await send({ url: "https://app/invite/izmisljen-token-izmisljen-token", email: "ana@dom.rs" })).status, 410);
    const res = await send({ url: body.invite.url, email: "ana@dom.rs" });
    assert.equal(res.status, 503);
    assert.match(res.body.message, /nije podešeno/);
    assert.equal((await request(app).post("/api/auth/links/send").set(authHeader(mainNurse)).send({ url: body.invite.url, email: "ana@dom.rs" })).status, 403);
  });
});

describe("nova lozinka", () => {
  test("admin šalje link; nova lozinka odjavljuje sve stare sesije", async () => {
    const nurse = await createUser("nurse", { username: "mira", passwordHash: await bcrypt.hash("stara-lozinka-1", 4) });
    const old = await request(app).post("/api/auth/login").send({ identifier: "mira", password: "stara-lozinka-1" });
    const oldCookie = String(old.headers["set-cookie"]).split(";")[0]!;

    const link = await request(app).post(`/api/auth/users/${nurse._id}/reset-link`).set(authHeader(admin));
    assert.equal(link.status, 200);
    assert.match(link.body.link.url, /\/reset-password\//);
    const res = await request(app).post(`/api/auth/link/${tokenOf(link.body.link.url)}`).send({ password: "posle-zaborava-77" });
    assert.equal(res.status, 200);
    assert.equal((await request(app).post("/api/auth/refresh").set("Cookie", oldCookie)).status, 403);
  });

  test("zaboravljena lozinka bez mejl servisa: uputstvo, isti odgovor za sve", async () => {
    const a = await request(app).post("/api/auth/forgot").send({ identifier: "direktor@dom.rs" });
    const b = await request(app).post("/api/auth/forgot").send({ identifier: "niko@dom.rs" });
    assert.equal(a.status, 200);
    assert.deepEqual(a.body, b.body);
    assert.equal(a.body.emailEnabled, false);
  });
});

describe("suspendovanje i brisanje", () => {
  test("suspendovanje gasi sesije; ne može sebe ni poslednjeg admina", async () => {
    const nurse = await createUser("nurse", { username: "mira", passwordHash: await bcrypt.hash("lozinka-mira-1", 4) });
    await request(app).post("/api/auth/login").send({ identifier: "mira", password: "lozinka-mira-1" });
    assert.equal(await Token.countDocuments({ user: nurse._id }), 1);

    const res = await request(app).patch(`/api/auth/users/${nurse._id}`).set(authHeader(admin)).send({ status: "suspended" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.status, "suspended");
    assert.equal(await Token.countDocuments({ user: nurse._id }), 0);

    assert.equal((await request(app).patch(`/api/auth/users/${admin._id}`).set(authHeader(admin)).send({ status: "suspended" })).status, 400);
    const admin2 = await createUser("admin");
    assert.equal((await request(app).patch(`/api/auth/users/${admin._id}`).set(authHeader(admin2)).send({ role: "nurse" })).status, 200, "ima drugog admina");
    assert.equal((await request(app).patch(`/api/auth/users/${admin2._id}`).set(authHeader(admin2)).send({ role: "nurse" })).status, 400, "sopstvena uloga");

    const back = await request(app).patch(`/api/auth/users/${nurse._id}`).set(authHeader(admin2)).send({ status: "active" });
    assert.equal(back.body.user.status, "active");
  });

  test("korišćen nalog se ne briše (suspenduje se); pozivnica se povlači", async () => {
    const used = await createUser("nurse", { lastLoginAt: new Date() });
    assert.equal((await request(app).delete(`/api/auth/users/${used._id}`).set(authHeader(admin))).status, 409);
    const { body } = await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" });
    assert.equal((await request(app).delete(`/api/auth/users/${body.user._id}`).set(authHeader(admin))).status, 200);
  });

  test("osoblje bez pristupa: evidencija bez prijave i bez mejla", async () => {
    const res = await request(app).post("/api/auth/staff").set(authHeader(admin)).send({ name: "Marko", lastName: "Kuhinja", role: "Kitchen" });
    assert.equal(res.status, 201);
    const second = await request(app).post("/api/auth/staff").set(authHeader(admin)).send({ name: "Jova", lastName: "Domar", role: "Janitor" });
    assert.equal(second.status, 201, "više zapisa bez mejla je u redu");
  });

  test("lista korisnika ne sadrži tajne", async () => {
    await invite({ name: "Ana", lastName: "Anić", email: "ana@dom.rs", role: "nurse" });
    const res = await request(app).get("/api/auth/users").set(authHeader(mainNurse));
    const body = JSON.stringify(res.body);
    for (const secret of ["passwordHash", "tokenHash", "googleId"]) assert.equal(body.includes(secret), false, secret);
    const ana = res.body.users.find((u: { email: string }) => u.email === "ana@dom.rs");
    assert.equal(ana.pendingLink.purpose, "invite");
    assert.equal(ana.hasPassword, false);
  });
});

describe("prijava preko Google-a", () => {
  const google = (email: string, sub = "google-123") => setGoogleVerifier(async () => ({ sub, email, emailVerified: true, name: "X" }));
  const signIn = (body: object = {}) => request(app).post("/api/auth/google").send({ credential: "google-id-token", ...body });

  test("bez pozivnice nema pristupa", async () => {
    google("stranac@gmail.com");
    const res = await signIn();
    assert.equal(res.status, 403);
    assert.match(res.body.message, /pozivnicom/);
  });

  test("pozvana adresa: prva Google prijava aktivira nalog i povezuje ga", async () => {
    await invite({ name: "Ana", lastName: "Anić", email: "ana@gmail.com", role: "doctor" });
    google("ana@gmail.com", "sub-ana");
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "doctor");
    const ana = must(await User.findOne({ email: "ana@gmail.com" }));
    assert.equal(ana.status, "active");
    assert.equal(ana.googleId, "sub-ana");
    assert.equal(ana.lastLoginMethod, "google");

    google("promenjen@gmail.com", "sub-ana");
    assert.equal((await signIn()).status, 200, "posle povezivanja prepoznaje se po Google nalogu");
  });

  test("pozivnica za drugu adresu se ne može iskoristiti tuđim Google nalogom", async () => {
    const { body } = await invite({ name: "Ana", lastName: "Anić", email: "ana@gmail.com", role: "nurse" });
    google("neko.drugi@gmail.com");
    const res = await signIn({ inviteToken: tokenOf(body.invite.url) });
    assert.equal(res.status, 403);
    assert.match(res.body.message, /ana@gmail.com/);
  });

  test("pozivnica samo sa korisničkim imenom: povezuje se Google nalog iz linka", async () => {
    const { body } = await invite({ name: "Sanja", lastName: "P", username: "sanja.p", role: "nurse" });
    google("sanja.privatno@gmail.com", "sub-sanja");
    const res = await signIn({ inviteToken: tokenOf(body.invite.url) });
    assert.equal(res.status, 200);
    assert.equal(must(await User.findOne({ username: "sanja.p" })).email, "sanja.privatno@gmail.com");
  });

  test("suspendovan korisnik ni Google-om", async () => {
    await createUser("nurse", { email: "mira@gmail.com", status: "suspended" });
    google("mira@gmail.com");
    assert.equal((await signIn()).status, 403);
  });
});
