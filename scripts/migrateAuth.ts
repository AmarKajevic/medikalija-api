// scripts/migrateAuth.ts
//
// Jednokratni prelaz na pristup samo po pozivu. Pokrenuti pri objavi ove verzije.
//
// Podrazumevano DRY-RUN (samo ispisuje šta bi promenio):
//   npm run migrate-auth
// Upis u bazu (napraviti backup pre toga!):
//   npm run migrate-auth -- --apply
//
// Šta radi:
//  1. svodi e-mail adrese na mala slova; prijavljuje duplikate (oni se moraju ručno rešiti)
//  2. postavlja status (active) starim zapisima koji ga nemaju
//  3. zamenjuje stari jedinstveni indeks na e-mailu indeksom koji dozvoljava osoblje bez mejla
//  4. hešira postojeće refresh tokene (korisnici ostaju prijavljeni)
//  5. ispisuje korisnike sa pristupom koji nemaju ni e-mail ni korisničko ime
//     (prijavljuju se starim načinom dok im admin ne doda jedno od toga)

import mongoose from "mongoose";
import connectToDatabase from "../db/db.js";
import User, { isActiveRole } from "../models/User.js";
import Token from "../models/Token.js";
import { hashToken } from "../services/auth/links.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectToDatabase();
  const users = User.collection;

  // 1. e-mail adrese
  const all = await users.find({}, { projection: { name: 1, lastName: 1, email: 1, username: 1, status: 1, role: 1, loginAllowed: 1 } }).toArray();
  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  let emailFixes = 0;
  for (const u of all) {
    if (typeof u.email !== "string") continue;
    const normalized = u.email.trim().toLowerCase();
    const who = `${u.name} ${u.lastName}`;
    if (seen.has(normalized)) duplicates.push(`${normalized}: ${seen.get(normalized)} i ${who}`);
    seen.set(normalized, who);
    if (normalized !== u.email) {
      emailFixes++;
      if (APPLY) await users.updateOne({ _id: u._id }, { $set: { email: normalized } });
    }
  }
  console.log(`E-mail adrese za ispravku (mala slova): ${emailFixes}`);
  if (duplicates.length) {
    console.log("PAŽNJA — isti e-mail kod više korisnika (rešite ručno pre --apply):");
    duplicates.forEach((d) => console.log(`  ${d}`));
    if (APPLY) throw new Error("Prekid: duplirane e-mail adrese.");
  }

  // 2. status
  const withoutStatus = all.filter((u) => !u.status).length;
  console.log(`Zapisi bez statusa (postaju aktivni): ${withoutStatus}`);
  if (APPLY) await users.updateMany({ status: { $exists: false } }, { $set: { status: "active" } });

  // 3. indeksi
  const indexes = await users.indexes();
  const oldEmail = indexes.find((i) => i.name === "email_1" && !i.partialFilterExpression);
  console.log(oldEmail ? "Stari indeks email_1 biće zamenjen." : "Indeksi su već ažurni.");
  if (APPLY) {
    if (oldEmail) await users.dropIndex("email_1");
    await User.syncIndexes();
  }

  // 4. refresh tokeni (stari zapisi su ceo JWT; novi su SHA-256 heš)
  const plain = await Token.find({ token: /\./ }, { token: 1 }).lean();
  console.log(`Refresh tokeni za heširanje: ${plain.length}`);
  if (APPLY) for (const t of plain) await Token.updateOne({ _id: t._id }, { $set: { token: hashToken(t.token) } });

  // 5. ko nema novi način prijave
  const noLogin = all.filter((u) => isActiveRole(u.role) && u.loginAllowed !== false && !u.email && !u.username);
  if (noLogin.length) {
    console.log("Korisnici bez e-maila i korisničkog imena (dodajte im jedno u Tim → Korisnici):");
    noLogin.forEach((u) => console.log(`  ${u.name} ${u.lastName} (${u.role})`));
  }

  console.log(APPLY ? "Gotovo." : "DRY-RUN — ništa nije upisano. Pokrenite sa --apply za upis.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
