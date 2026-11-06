// Zajednička infrastruktura za testove: privremeni MongoDB, test korisnici i JWT.
import { after, before, beforeEach } from "node:test";
import mongoose, { type HydratedDocument } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import jwt from "jsonwebtoken";
import User, { type Role, type UserAttrs } from "../../models/User.js";
import Patient from "../../models/Patient.js";

process.env.JWT_KEY ??= "test-jwt-key";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-key";
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

export async function createUser(role: Role, overrides: Partial<UserAttrs> = {}): Promise<UserDoc> {
  counter += 1;
  return User.create({
    name: `Test${counter}`,
    lastName: role,
    email: `user${counter}@test.local`,
    passwordHash: "x",
    role,
    ...overrides,
  });
}

export const tokenFor = (user: UserDoc) =>
  jwt.sign({ _id: String(user._id), role: user.role }, must(process.env.JWT_KEY), { expiresIn: "1h" });

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
