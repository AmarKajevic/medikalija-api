// scripts/normalizeDates.js
//
// Jednokratna migracija: svodi sve kalendarske datume (prijem, otpust, rođenje,
// periodi specifikacija) na UTC ponoć, u skladu sa utils/dateUtils.js.
//
// Podrazumevano radi DRY-RUN (samo ispisuje šta bi promenio):
//   node --env-file=.env scripts/normalizeDates.js
// Upis u bazu (napraviti backup pre toga!):
//   node --env-file=.env scripts/normalizeDates.js --apply
//
// Skripta ne menja trajanje nijednog perioda niti spaja duplikate. Periode koji
// nemaju 30 dana i duplikate samo ispisuje, da ih admin pregleda ručno.

import mongoose, { type Document, type Model } from "mongoose";
import connectToDatabase from "../db/db.js";
import Patient from "../models/Patient.js";
import Specification from "../models/Specification.js";
import { SPEC_PERIOD_DAYS, diffInDays, normalizeStoredDay, toDateKey } from "../utils/dateUtils.js";

const APPLY = process.argv.includes("--apply");

function collectChanges(doc: Document, paths: string[]): Record<string, Date> {
  const set: Record<string, Date> = {};
  for (const path of paths) {
    const value = doc.get(path);
    if (!value) continue;
    const normalized = normalizeStoredDay(value);
    if (normalized && normalized.getTime() !== new Date(value).getTime()) {
      set[path] = normalized;
    }
  }
  return set;
}

async function normalizeCollection<T>(Model: Model<T>, paths: string[], label: string) {
  const ops: Array<{ updateOne: { filter: { _id: unknown }; update: { $set: Record<string, Date> } } }> = [];
  for await (const doc of Model.find().cursor()) {
    const set = collectChanges(doc, paths);
    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
      const diff = Object.entries(set)
        .map(([p, v]) => `${p}: ${new Date(doc.get(p)).toISOString()} -> ${toDateKey(v)}`)
        .join(", ");
      console.log(`[${label}] ${doc._id} ${diff}`);
    }
  }

  if (APPLY && ops.length) {
    const res = await Model.bulkWrite(ops, { ordered: false });
    console.log(`[${label}] izmenjeno: ${res.modifiedCount}`);
  } else {
    console.log(`[${label}] za izmenu: ${ops.length}${APPLY ? "" : " (dry-run)"}`);
  }
}

async function reportSpecificationAnomalies() {
  const seen = new Map();
  let irregular = 0;
  let duplicates = 0;

  for await (const spec of Specification.find().sort({ patientId: 1, startDate: 1 }).cursor()) {
    const start = normalizeStoredDay(spec.startDate) ?? spec.startDate;
    const end = normalizeStoredDay(spec.endDate) ?? spec.endDate;
    const days = diffInDays(start, end) + 1;

    if (days !== SPEC_PERIOD_DAYS) {
      irregular++;
      console.log(
        `[provera] ${spec._id} pacijent ${spec.patientId}: ${toDateKey(start)} – ${toDateKey(end)} = ${days} dana`
      );
    }

    const key = `${spec.patientId}|${toDateKey(start)}|${toDateKey(end)}`;
    if (seen.has(key)) {
      duplicates++;
      console.log(`[duplikat] ${spec._id} isti period kao ${seen.get(key)} (${key})`);
    } else {
      seen.set(key, spec._id.toString());
    }
  }

  console.log(`[provera] periodi koji nemaju ${SPEC_PERIOD_DAYS} dana: ${irregular} (otpust ili ručni unos je OK, ostalo pregledati)`);
  console.log(`[provera] duplikati perioda: ${duplicates}`);
}

async function main() {
  await connectToDatabase();
  console.log(APPLY ? "=== APPLY: upisujem izmene ===" : "=== DRY-RUN: ništa se ne upisuje ===");

  await normalizeCollection(Patient, ["admissionDate", "dischargeDate", "dateOfBirth"], "Patient");
  await normalizeCollection(
    Specification,
    ["startDate", "endDate", "billing.nextPeriodStart", "billing.nextPeriodEnd"],
    "Specification"
  );
  await reportSpecificationAnomalies();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
