// Zajednička infrastruktura za testove: privremeni MongoDB, test korisnici i JWT.
import { after, before, beforeEach } from "node:test";
import mongoose, { type HydratedDocument } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User, { type Role, type UserAttrs } from "../../models/User.js";
import Patient from "../../models/Patient.js";
import Session from "../../models/Session.js";
import { signAccessToken, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../../services/auth/sessions.js";

process.env.JWT_KEY ??= "test-jwt-key";
process.env.NODE_ENV ??= "test";

export type UserDoc = HydratedDocument<UserAttrs>;

/** Vrednost koja u testu mora postojati — inače test pada sa jasnom porukom. */
export function must<T>(value: T, what = "vrednost"): NonNullable<T> {
  if (value === null || value === undefined) throw new Error(`Očekivana ${what}, a dobijeno ${String(value)}`);
  return value as NonNullable<T>;
}

/** Podiže in-memory MongoDB za ceo fajl i prazni bazu pre svakog testa. */
export function useTestDatabase() {
  let mongo: MongoMemoryServer | undefined;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  beforeEach(async () => {
    await must(mongoose.connection.db, "konekcija").dropDatabase();
    await Promise.all(mongoose.modelNames().map((m) => mongoose.model(m).syncIndexes()));
  });
}

let counter = 0;

// Svaki test korisnik dobija pravu sesiju (kao posle prijave), pa authHeader radi kao u aplikaciji
const sessionOf = new Map<string, string>();

export async function createUser(role: Role, overrides: Partial<UserAttrs> = {}): Promise<UserDoc> {
  counter += 1;
  const user = await User.create({
    name: `Test${counter}`,
    lastName: role,
    email: `user${counter}@test.local`,
    passwordHash: "x",
    role,
    ...overrides,
  });
  const now = Date.now();
  const session = await Session.create({
    user: user._id,
    tokenHash: `test-${counter}`,
    method: "password",
    expiresAt: new Date(now + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS),
  });
  sessionOf.set(String(user._id), String(session._id));
  return user;
}

export const tokenFor = (user: UserDoc) => signAccessToken(user._id, must(sessionOf.get(String(user._id)), "sesija test korisnika"));

export const authHeader = (user: UserDoc) => ({ Authorization: `Bearer ${tokenFor(user)}` });

export const DAY_MS = 86_400_000;

export async function createPatient(overrides: Record<string, unknown> = {}) {
  return Patient.create({
    name: "Petar",
    lastName: "Petrović",
    dateOfBirth: new Date("1940-01-01T00:00:00Z"),
    address: "Beograd",
    admissionDate: new Date(Date.now() - 5 * DAY_MS),
    ...overrides,
  });
}
