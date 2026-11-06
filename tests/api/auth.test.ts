import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import app from "../../app.js";
import Token from "../../models/Token.js";
import { authHeader, createUser, useTestDatabase, type UserDoc } from "../helpers/setup.js";

useTestDatabase();

let nurse: UserDoc;

beforeEach(async () => {
  nurse = await createUser("nurse", { name: "Sanja", lastName: "Sestra", passwordHash: await bcrypt.hash("tajna1234", 4) });
});

const login = (body: Record<string, string>) => request(app).post("/api/auth/login").send(body);

describe("POST /api/auth/login", () => {
  test("ispravni podaci: access token + httpOnly refresh cookie", async () => {
    const res = await login({ name: "sanja", lastName: "SESTRA", password: "tajna1234" });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "nurse");
    assert.equal(res.body.user.passwordHash, undefined, "heš lozinke ne sme da izađe iz API-ja");
    assert.ok(jwt.decode(res.body.accessToken));
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /refreshToken=/);
    assert.match(cookie, /HttpOnly/i);
    assert.equal(await Token.countDocuments(), 1);
  });

  test("pogrešna lozinka → 400", async () => {
    const res = await login({ name: "Sanja", lastName: "Sestra", password: "pogresna" });
    assert.equal(res.status, 400);
  });

  test("regex znakovi u imenu se ne tumače kao šablon (nema prijave sa '.*')", async () => {
    const res = await login({ name: ".*", lastName: ".*", password: "tajna1234" });
    assert.equal(res.status, 404);
  });

  test("nedostaju podaci → 400", async () => {
    const res = await login({ name: "Sanja" });
    assert.equal(res.status, 400);
  });

  test("uloga bez pristupa aplikaciji (kuhinja) → 403", async () => {
    await createUser("Kitchen", { name: "Marko", lastName: "Kuhinja", passwordHash: await bcrypt.hash("tajna1234", 4) });
    const res = await login({ name: "Marko", lastName: "Kuhinja", password: "tajna1234" });
    assert.equal(res.status, 403);
  });
});

describe("zaštita ruta", () => {
  test("bez tokena → 401", async () => {
    const res = await request(app).get("/api/auth/verify");
    assert.equal(res.status, 401);
  });

  test("lažan token → 403", async () => {
    const res = await request(app).get("/api/auth/verify").set("Authorization", "Bearer nije.pravi.token");
    assert.equal(res.status, 403);
  });

  test("token potpisan drugim ključem → 403", async () => {
    const forged = jwt.sign({ _id: String(nurse._id), role: "admin" }, "drugi-kljuc");
    const res = await request(app).get("/api/auth/verify").set("Authorization", `Bearer ${forged}`);
    assert.equal(res.status, 403);
  });

  test("važeći token → korisnik bez heša lozinke", async () => {
    const res = await request(app).get("/api/auth/verify").set(authHeader(nurse));
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(res.body).includes("passwordHash"), false);
  });
});

describe("POST /api/auth/refresh", () => {
  test("rotira refresh token: stari više ne važi", async () => {
    const first = await login({ name: "Sanja", lastName: "Sestra", password: "tajna1234" });
    const cookie = String(first.headers["set-cookie"]).split(";")[0]!;

    const refreshed = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.body.accessToken);

    const reused = await request(app).post("/api/auth/refresh").set("Cookie", cookie);
    assert.equal(reused.status, 403, "iskorišćen refresh token mora biti odbijen");
  });
});

describe("registracija korisnika", () => {
  test("samo admin sme da registruje", async () => {
    const body = { name: "Nova", lastName: "Sestra", email: "nova@test.local", password: "sigurna123", role: "nurse" };
    const asNurse = await request(app).post("/api/auth/register").set(authHeader(nurse)).send(body);
    assert.equal(asNurse.status, 403);

    const admin = await createUser("admin");
    const asAdmin = await request(app).post("/api/auth/register").set(authHeader(admin)).send(body);
    assert.equal(asAdmin.status, 201);
  });
});
