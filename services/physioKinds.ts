import mongoose from "mongoose";
import PhysioPrice from "../models/PhysioPrice.js";
import { PHYSIO_KINDS, type PhysioKind } from "../models/NurseEntry.js";
import { httpError } from "../utils/errors.js";

export const PHYSIO_LABEL: Record<PhysioKind, string> = {
  active: "Individualna aktivna fizikalna terapija",
  passive: "Individualna pasivna fizikalna terapija",
  group: "Grupna fizikalna terapija",
};

export const isBuiltInPhysioKind = (kind: unknown): kind is PhysioKind => PHYSIO_KINDS.includes(kind as PhysioKind);

export interface PhysioKindRow {
  kind: string;
  name: string;
  /** null = cena još nije uneta (samo osnovne vrste) */
  priceRSD: number | null;
  /** Vrsta koju je dodao admin (može se preimenovati i obrisati) */
  custom: boolean;
}

/** Sve vrste fizikalne terapije: tri osnovne, pa one koje je dodao admin (po nazivu) */
export async function listPhysioKinds(): Promise<PhysioKindRow[]> {
  const rows = await PhysioPrice.find().lean();
  const builtIn = PHYSIO_KINDS.map((kind) => ({ kind, name: PHYSIO_LABEL[kind], priceRSD: rows.find((r) => r.kind === kind)?.priceRSD ?? null, custom: false }));
  const custom = rows
    .filter((r) => !isBuiltInPhysioKind(r.kind))
    .map((r) => ({ kind: r.kind, name: r.name || "Fizikalna terapija", priceRSD: r.priceRSD, custom: true }))
    .sort((a, b) => a.name.localeCompare(b.name, "sr"));
  return [...builtIn, ...custom];
}

/** Vrsta mora postojati (osnovna ili dodata); vraća njen naziv i cenu */
export async function findPhysioKind(kind: unknown): Promise<PhysioKindRow> {
  if (typeof kind !== "string" || !kind) throw httpError(400, "Izaberite vrstu fizikalne terapije.");
  const row = await PhysioPrice.findOne({ kind }).lean();
  if (isBuiltInPhysioKind(kind)) return { kind, name: PHYSIO_LABEL[kind], priceRSD: row?.priceRSD ?? null, custom: false };
  if (!row) throw httpError(400, "Izaberite vrstu fizikalne terapije.");
  return { kind, name: row.name || "Fizikalna terapija", priceRSD: row.priceRSD, custom: true };
}

export const newPhysioKind = () => `c${new mongoose.Types.ObjectId().toHexString()}`;
