import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import Session from "../../models/Session.js";
import { SESSION_ABSOLUTE_MS } from "../../services/auth/sessions.js";
import User from "../../models/User.js";
import { allowedOrigins } from "../../utils/cors.js";
import { authHeader, createUser, must, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let nurse: UserDoc;
const PASSWORD = "tajna-lozinka-1";

beforeEach(async () => {
  nurse = await createUser("nurse", { name: "Sanja", lastName: "Sestra", email: "sanja@dom.rs", username: "sanja.s", passwordHash: await bcrypt.hash(PASSWORD, 4) });
});

const login = (body: Record<string, string>) => request(app).post("/api/auth/login").send(body);
// Refresh kolačić iz odgovora ("rt=..."); ostali (npr. brisanje starog) se preskaču
const cookieOf = (res: request.Response) => {
  const all = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  return must(all.find((c) => c.startsWith("rt=")), "refresh kolačić").split(";")[0]!;
};
const refresh = (cookie: string) => request(app).post("/api/auth/refresh").set("Cookie", cookie);
const signIn = () => login({ identifier: "sanja.s", password: PASSWORD });

describe("POST /api/auth/login", () => {
  test("e-mail (bez obzira na velika slova) ili korisničko ime: token + httpOnly kolačić", async () => {
    for (const identifier of ["SANJA@dom.rs", "sanja.s"]) {
      const res = await login({ identifier, password: PASSWORD });
      assert.equal(res.status, 200, identifier);
      assert.equal(res.body.user.role, "nurse");
      assert.equal(res.body.user.passwordHash, undefined, "heš lozinke ne sme da izađe iz API-ja");
      assert.ok(jwt.decode(res.body.accessToken));
      const setCookie = String(res.headers["set-cookie"]);
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /Path=\/api\/auth/, "kolačić se šalje samo uz /api/auth");
      const claims = jwt.decode(res.body.accessToken) as jwt.JwtPayload;
      assert.equal(claims.sub, String(nurse._id));
      assert.ok(claims.sid, "access token je vezan za sesiju");
      assert.equal(claims.exp! - claims.iat!, 15 * 60, "access token traje 15 minuta");
    }
    const u = must(await User.findById(nurse._id));
    assert.equal(u.lastLoginMethod, "password");
    assert.ok(u.lastLoginAt);
  });

  test("u bazi je samo heš refresh tokena; sesija pamti uređaj", async () => {
    const res = await login({ identifier: "sanja.s", password: PASSWORD }).set("User-Agent", "Firefox na odeljenju");
    const raw = decodeURIComponent(cookieOf(res).split("=")[1]!);
    const stored = must(await Session.findOne({ user: nurse._id, userAgent: "Firefox na odeljenju" }));
    assert.equal(raw.split(".")[0], String(stored._id));
    assert.equal(raw.includes(stored.tokenHash), false);
    assert.equal(stored.tokenHash.length, 64);
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
  test("bez tokena, lažan, tuđim ključem ili drugim algoritmom potpisan → 401", async () => {
    const verify = (token?: string) => {
      const req = request(app).get("/api/auth/verify");
      return token ? req.set("Authorization", `Bearer ${token}`) : req;
    };
    assert.equal((await verify()).body.code, "token_missing");
    assert.equal((await verify("nije.pravi.token")).status, 401);
    const opts = { subject: String(nurse._id), issuer: "medikalija-api", audience: "medikalija-app" };
    assert.equal((await verify(jwt.sign({ sid: "x" }, "drugi-kljuc", opts))).status, 401);
    assert.equal((await verify(jwt.sign({ sid: "x" }, must(process.env.JWT_KEY), { ...opts, algorithm: "HS512" }))).status, 401, "samo HS256");
    // Stari format tokena (bez sesije) više ne važi
    assert.equal((await verify(jwt.sign({ _id: String(nurse._id), role: "admin" }, must(process.env.JWT_KEY)))).status, 401);
  });

  test("istekao access token → 401 token_expired (frontend tada osvežava sesiju)", async () => {
    const res = await signIn();
    const { sid } = jwt.decode(res.body.accessToken) as { sid: string };
    const expired = jwt.sign({ sid }, must(process.env.JWT_KEY), { subject: String(nurse._id), issuer: "medikalija-api", audience: "medikalija-app", expiresIn: -10 });
    const out = await request(app).get("/api/auth/verify").set("Authorization", `Bearer ${expired}`);
    assert.equal(out.status, 401);
    assert.equal(out.body.code, "token_expired");
  });

  test("odjava gasi i access token odmah (ne tek kad istekne)", async () => {
    const res = await signIn();
    const bearer = { Authorization: `Bearer ${res.body.accessToken}` };
    assert.equal((await request(app).get("/api/auth/verify").set(bearer)).status, 200);
    assert.equal((await request(app).post("/api/auth/logout").set("Cookie", cookieOf(res))).status, 200);
    const after = await request(app).get("/api/auth/verify").set(bearer);
    assert.equal(after.status, 401);
    assert.equal(after.body.code, "session_revoked");
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

  test("bezbednosna zaglavlja; nepoznata ruta i neispravan JSON bez internih detalja", async () => {
    const res = await request(app).get("/api/auth/config");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["strict-transport-security"]);
    assert.equal(res.headers["x-powered-by"], undefined);
    const missing = await request(app).get("/api/nema-ove-rute");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);
    const bad = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send("{ovo nije json");
    assert.equal(bad.status, 400);
    assert.equal(JSON.stringify(bad.body).includes("JSON at position"), false);
  });
});

describe("POST /api/auth/refresh", () => {
  test("rotira refresh token; ista sesija; nov access token", async () => {
    const res = await signIn();
    const cookie = cookieOf(res);
    const refreshed = await refresh(cookie);
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);
    assert.equal(refreshed.body.user.passwordHash, undefined);
    assert.notEqual(cookieOf(refreshed), cookie, "novi refresh token");
    const sid = (t: string) => (jwt.decode(t) as { sid: string }).sid;
    assert.equal(sid(refreshed.body.accessToken), sid(res.body.accessToken), "ista sesija");
    assert.equal((await refresh(cookieOf(refreshed))).status, 200, "novi token radi");
  });

  test("izgubljen odgovor (reload usred osvežavanja): stari token radi i kasnije — nema odjave", async () => {
    const cookie = cookieOf(await signIn());
    assert.equal((await refresh(cookie)).status, 200, "server je rotirao, ali odgovor nije stigao do browsera");
    await Session.updateMany({ user: nurse._id }, { $set: { rotatedAt: new Date(Date.now() - 20 * 60_000) } });
    const later = await refresh(cookie);
    assert.equal(later.status, 200, "i posle 20 minuta, jer novi token niko nije upotrebio");
    assert.equal((await refresh(cookieOf(later))).status, 200, "nastavlja se normalno");
  });

  test("krađa: zamenjen token upotrebljen pošto je novi već korišćen → gasi se cela sesija", async () => {
    const stolen = cookieOf(await signIn());
    const second = await refresh(stolen); // korisnik osvežava
    const third = await refresh(cookieOf(second)); // i opet — tok je odmakao
    const reuse = await refresh(stolen); // napadač pokušava sa ukradenim
    assert.equal(reuse.status, 401);
    assert.equal(reuse.body.code, "session_reused");
    assert.equal((await refresh(cookieOf(third))).status, 401, "sesija je ugašena i za korisnika (mora ponovo da se prijavi)");
    const bearer = { Authorization: `Bearer ${third.body.accessToken}` };
    assert.equal((await request(app).get("/api/auth/verify").set(bearer)).status, 401, "access token te sesije takođe");
  });

  test("krađa pre korisnika: napadač osveži ukradenim, korisnikov sledeći pokušaj gasi sesiju", async () => {
    const original = cookieOf(await signIn());
    const userGot = await refresh(original); // korisnik dobije novi token
    const attacker = await refresh(original); // napadač sa starim (novi još nije upotrebljen) — dobija token
    assert.equal(attacker.status, 200);
    const userNext = await refresh(cookieOf(userGot)); // korisnikov token je povučen → krađa
    assert.equal(userNext.status, 401);
    assert.equal(userNext.body.code, "session_reused");
    assert.equal((await refresh(cookieOf(attacker))).status, 401, "napadačeva sesija je ugašena");
  });

  test("apsolutni rok sesije: posle 30 dana nova prijava, bez obzira na aktivnost", async () => {
    const cookie = cookieOf(await signIn());
    await Session.updateMany({ user: nurse._id }, { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    const res = await refresh(cookie);
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "session_expired");
    assert.ok(SESSION_ABSOLUTE_MS >= 7 * 86_400_000);
  });

  test("bez kolačića, lažan ili stari (JWT) kolačić → 401", async () => {
    assert.equal((await request(app).post("/api/auth/refresh")).status, 401);
    assert.equal((await refresh("rt=nije-token")).status, 401);
    const session = must(await Session.findOne({ user: nurse._id }));
    assert.equal((await refresh(`rt=${session._id}.${"x".repeat(43)}`)).status, 401, "tuđ ID sesije bez tajne");
    assert.ok(await Session.exists({ _id: session._id }), "pogađanje ne gasi tuđu sesiju");
    const legacy = await request(app).post("/api/auth/refresh").set("Cookie", "refreshToken=stari.jwt.token");
    assert.equal(legacy.status, 401);
    assert.match(String(legacy.headers["set-cookie"]), /refreshToken=;/, "stari kolačić se briše");
  });

  test("zahtev sa tuđeg sajta (CSRF) se odbija", async () => {
    const cookie = cookieOf(await signIn());
    const evil = await refresh(cookie).set("Origin", "https://zlonamerni.example");
    assert.equal(evil.status, 403);
    assert.equal((await refresh(cookie).set("Origin", allowedOrigins()[0]!)).status, 200, "naš frontend");
    // Naša aplikacija šalje zaglavlje: radi sa bilo koje adrese (sopstveni domen, preview), tuđ sajt ga ne može poslati
    const custom = await refresh(cookieOf(await signIn())).set("Origin", "https://dom.medikalija.rs").set("X-Requested-With", "medikalija");
    assert.equal(custom.status, 200);
  });

  test("suspendovan korisnik ne može da produži sesiju", async () => {
    const cookie = cookieOf(await signIn());
    await User.updateOne({ _id: nurse._id }, { status: "suspended" });
    assert.equal((await refresh(cookie)).status, 401);
    assert.equal(await Session.countDocuments({ user: nurse._id }), 0);
  });
});

describe("aktivni uređaji", () => {
  test("lista mojih sesija, odjava jednog i svih ostalih", async () => {
    const phone = await signIn().set("User-Agent", "Telefon");
    const laptop = await signIn().set("User-Agent", "Laptop");
    const asLaptop = { Authorization: `Bearer ${laptop.body.accessToken}` };

    const list = await request(app).get("/api/auth/sessions").set(asLaptop);
    assert.equal(list.status, 200);
    const mine = list.body.sessions as Array<{ id: string; userAgent: string; current: boolean }>;
    assert.equal(mine.find((s) => s.current)?.userAgent, "Laptop");
    assert.equal(JSON.stringify(list.body).includes("tokenHash"), false, "heševi ne izlaze");

    const phoneId = must(mine.find((s) => s.userAgent === "Telefon")).id;
    assert.equal((await request(app).delete(`/api/auth/sessions/${phoneId}`).set(asLaptop)).status, 200);
    assert.equal((await refresh(cookieOf(phone))).status, 401, "telefon je odjavljen");

    const others = await request(app).post("/api/auth/sessions/revoke-others").set(asLaptop);
    assert.equal(others.status, 200);
    assert.equal((await request(app).get("/api/auth/verify").set(asLaptop)).status, 200, "trenutni uređaj ostaje");
    assert.equal(await Session.countDocuments({ user: nurse._id }), 1);

    const other = await createUser("nurse");
    assert.equal((await request(app).delete(`/api/auth/sessions/${phoneId}`).set(authHeader(other))).status, 404, "tuđa sesija");
  });
});

describe("ograničenje broja zahteva", () => {
  test("zaboravljena lozinka: posle 5 zahteva za isti nalog → 429; drugi nalog sa iste adrese radi", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await request(app).post("/api/auth/forgot").send({ identifier: "x@dom.rs" })).status, 200);
    const limited = await request(app).post("/api/auth/forgot").send({ identifier: "x@dom.rs" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.equal((await request(app).post("/api/auth/forgot").send({ identifier: "kolega@dom.rs" })).status, 200, "ceo dom je iza iste adrese");
  });

  test("prijava: granica po nalogu, ne po adresi celog doma", async () => {
    for (let i = 0; i < 20; i++) await login({ identifier: "niko@dom.rs", password: "pogresna-lozinka" });
    assert.equal((await login({ identifier: "niko@dom.rs", password: "pogresna-lozinka" })).status, 429);
    assert.equal((await signIn()).status, 200, "kolega sa istog rutera se prijavljuje");
  });
});

describe("promena sopstvene lozinke", () => {
  test("traži trenutnu lozinku, proverava jačinu, odjavljuje ostale uređaje", async () => {
    const phone = cookieOf(await login({ identifier: "sanja.s", password: PASSWORD }));
    const laptopRes = await login({ identifier: "sanja.s", password: PASSWORD });
    const laptop = cookieOf(laptopRes);
    const change = (body: object) => request(app).post("/api/auth/password").set("Authorization", `Bearer ${laptopRes.body.accessToken}`).send(body);

    assert.equal((await change({ currentPassword: "pogresna", newPassword: "nova-dobra-lozinka" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "kr4t" })).status, 400);
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "sanja12345678" })).status, 400, "ne sme sadržati ime");
    assert.equal((await change({ currentPassword: PASSWORD, newPassword: "nova-dobra-lozinka" })).status, 200);

    assert.equal((await refresh(phone)).status, 401, "drugi uređaj je odjavljen");
    assert.equal((await refresh(laptop)).status, 200, "trenutni ostaje prijavljen");
    assert.equal((await login({ identifier: "sanja.s", password: "nova-dobra-lozinka" })).status, 200);
  });
});
