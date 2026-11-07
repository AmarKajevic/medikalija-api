import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import Token from "../../models/Token.js";
import User from "../../models/User.js";
import { authHeader, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let nurse: UserDoc;
const PASSWORD = "tajna-lozinka-1";

beforeEach(async () => {
  nurse = await createUser("nurse", { name: "Sanja", lastName: "Sestra", email: "sanja@dom.rs", username: "sanja.s", passwordHash: await bcrypt.hash(PASSWORD, 4) });
});

const login = (body: Record<string, string>) => request(app).post("/api/auth/login").send(body);
const cookieOf = (res: request.Response) => String(res.headers["set-cookie"]).split(";")[0]!;

describe("POST /api/auth/login", () => {
  test("e-mail (bez obzira na velika slova) ili korisničko ime: token + httpOnly kolačić", async () => {
    for (const identifier of ["SANJA@dom.rs", "sanja.s"]) {
      const res = await login({ identifier, password: PASSWORD });
      assert.equal(res.status, 200, identifier);
      assert.equal(res.body.user.role, "nurse");
      assert.equal(res.body.user.passwordHash, undefined, "heš lozinke ne sme da izađe iz API-ja");
      assert.ok(jwt.decode(res.body.accessToken));
      assert.match(String(res.headers["set-cookie"]), /HttpOnly/i);
    }
    const u = must(await User.findById(nurse._id));
    assert.equal(u.lastLoginMethod, "password");
    assert.ok(u.lastLoginAt);
  });

  test("u bazi je samo heš refresh tokena", async () => {
    const res = await login({ identifier: "sanja.s", password: PASSWORD });
    const raw = decodeURIComponent(cookieOf(res).split("=")[1]!);
    const stored = must(await Token.findOne());
    assert.notEqual(stored.token, raw);
    assert.equal(stored.token.length, 64);
  });

  test("ista poruka za nepostojećeg korisnika i pogrešnu lozinku (ne otkriva ko radi u domu)", async () => {
    const wrong = await login({ identifier: "sanja.s", password: "pogresna-lozinka" });
    const unknown = await login({ identifier: "niko@dom.rs", password: "pogresna-lozinka" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
  });

  test("posle 5 pogrešnih pokušaja nalog je zaključan i za tačnu lozinku", async () => {
    for (let i = 0; i < 5; i++) await login({ identifier: "sanja.s", password: "pogresna-lozinka" });
    const locked = await login({ identifier: "sanja.s", password: PASSWORD });
    assert.equal(locked.status, 429);
    assert.match(locked.body.message, /Pokušajte ponovo za \d+ min/);
  });

  test("prelazno: ime i prezime rade samo kad je osoba jedinstvena", async () => {
    assert.equal((await login({ name: "sanja", lastName: "SESTRA", password: PASSWORD })).status, 200);
    await createUser("nurse", { name: "Sanja", lastName: "Sestra", passwordHash: await bcrypt.hash(PASSWORD, 4) });
    assert.equal((await login({ name: "Sanja", lastName: "Sestra", password: PASSWORD })).status, 401, "dve osobe istog imena — ne pogađa se");
  });

  test("regex znakovi se ne tumače kao šablon", async () => {
    assert.equal((await login({ name: ".*", lastName: ".*", password: PASSWORD })).status, 401);
  });

  test("nedostaju podaci → 400", async () => {
    assert.equal((await login({ identifier: "sanja.s" })).status, 400);
  });

  test("uloga bez pristupa i suspendovan nalog → 403", async () => {
    await createUser("Kitchen", { name: "Marko", lastName: "Kuhinja", username: "marko", passwordHash: await bcrypt.hash(PASSWORD, 4) });
    assert.equal((await login({ identifier: "marko", password: PASSWORD })).status, 403);
    await User.updateOne({ _id: nurse._id }, { status: "suspended" });
    const res = await login({ identifier: "sanja.s", password: PASSWORD });
    assert.equal(res.status, 403);
    assert.match(res.body.message, /ukinut/);
  });
});

describe("zaštita ruta", () => {
  test("bez tokena → 401; lažan ili tuđim ključem potpisan → 403", async () => {
    assert.equal((await request(app).get("/api/auth/verify")).status, 401);
    assert.equal((await request(app).get("/api/auth/verify").set("Authorization", "Bearer nije.pravi.token")).status, 403);
    const forged = jwt.sign({ _id: String(nurse._id), role: "admin" }, "drugi-kljuc");
    assert.equal((await request(app).get("/api/auth/verify").set("Authorization", `Bearer ${forged}`)).status, 403);
  });

  test("važeći token → korisnik bez tajni", async () => {
    const res = await request(app).get("/api/auth/verify").set(authHeader(nurse));
    assert.equal(res.status, 200);
    const body = JSON.stringify(res.body);
    for (const secret of ["passwordHash", "tokenHash", "googleId", "failedLogins"]) assert.equal(body.includes(secret), false, secret);
  });

  test("suspendovan korisnik gubi pristup odmah, i sa još važećim tokenom", async () => {
    await User.updateOne({ _id: nurse._id }, { status: "suspended" });
    assert.equal((await request(app).get("/api/patient").set(authHeader(nurse))).status, 401);
  });
});

describe("POST /api/auth/refresh", () => {
  test("rotira refresh token: stari više ne važi", async () => {
    const cookie = cookieOf(await login({ identifier: "sanja.s", password: PASSWORD }));
    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);
    assert.equal((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status, 403, "iskorišćen refresh token mora biti odbijen");
  });

  test("suspendovan korisnik ne može da produži sesiju", async () => {
    const cookie = cookieOf(await login({ identifier: "sanja.s", password: PASSWORD }));
    await User.updateOne({ _id: nurse._id }, { status: "suspended" });
    assert.equal((await request(app).post("/api/auth/refresh").set("Cookie", cookie)).status, 403);
    assert.equal(await Token.countDocuments({ user: nurse._id }), 0);
  });

  test("stari (neheširani) refresh token iz baze još radi i rotira se u heširani", async () => {
    const legacy = jwt.sign({ _id: String(nurse._id), role: "nurse", jti: "x" }, must(process.env.JWT_REFRESH_SECRET), { expiresIn: "7d" });
    await Token.create({ user: nurse._id, token: legacy, expiresAt: new Date(Date.now() + 86_400_000) });
    const res = await request(app).post("/api/auth/refresh").set("Cookie", `refreshToken=${legacy}`);
    assert.equal(res.status, 200);
    assert.equal(await Token.countDocuments({ token: legacy }), 0);
  });
});

describe("promena sopstvene lozinke", () => {
  test("traži trenutnu lozinku, proverava jačinu, odjavljuje ostale uređaje", async () => {
    const phone = cookieOf(await login({ identifier: "sanja.s", password: PASSWORD }));
    const laptopRes = await login({ identifier: "sanja.s", password: PASSWORD });
    const laptop = cookieOf(laptopRes);
    const change = (body: object) => request(app).post("/api/auth/password").set(authHeader(nurse)).set("Cookie", laptop).send(body);

    assert.equal((await change({ currentPassword: "pogresna", newPassword: "nova-dobra-lozinka" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "kratka" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "sanja12345678" })).status, 400, "ne sme sadržati ime");
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "nova-dobra-lozinka" })).status, 200);

    assert.equal((await request(app).post("/api/auth/refresh").set("Cookie", phone)).status, 403, "drugi uređaj je odjavljen");
    assert.equal((await request(app).post("/api/auth/refresh").set("Cookie", laptop)).status, 200, "trenutni ostaje prijavljen");
    assert.equal((await login({ identifier: "sanja.s", password: "nova-dobra-lozinka" })).status, 200);
  });
});
