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
  /** Vrsta koju je dodao admin (osnovne su "active" | "passive" | "group") */
  custom: boolean;
}

/** Sve vrste fizikalne terapije: osnovne (koje nisu obrisane), pa one koje je dodao admin (po nazivu) */
export async function listPhysioKinds(): Promise<PhysioKindRow[]> {
  const rows = await PhysioPrice.find().lean();
  const builtIn = PHYSIO_KINDS.flatMap((kind) => {
    const row = rows.find((r) => r.kind === kind);
    if (row?.deleted) return [];
    return [{ kind, name: row?.name || PHYSIO_LABEL[kind], priceRSD: row?.priceRSD ?? null, custom: false }];
  });
  const custom = rows
    .filter((r) => !isBuiltInPhysioKind(r.kind))
    .map((r) => ({ kind: r.kind, name: r.name || "Fizikalna terapija", priceRSD: r.priceRSD ?? null, custom: true }))
    .sort((a, b) => a.name.localeCompare(b.name, "sr"));
  return [...builtIn, ...custom];
}

/** Vrsta mora postojati (osnovna koja nije obrisana, ili dodata); vraća njen naziv i cenu */
export async function findPhysioKind(kind: unknown): Promise<PhysioKindRow> {
  if (typeof kind !== "string" || !kind) throw httpError(400, "Izaberite vrstu fizikalne terapije.");
  const row = await PhysioPrice.findOne({ kind }).lean();
  if (row?.deleted || (!row && !isBuiltInPhysioKind(kind))) throw httpError(400, "Ova vrsta fizikalne terapije ne postoji (obrisana je).");
  if (isBuiltInPhysioKind(kind)) return { kind, name: row?.name || PHYSIO_LABEL[kind], priceRSD: row?.priceRSD ?? null, custom: false };
  return { kind, name: row!.name || "Fizikalna terapija", priceRSD: row!.priceRSD ?? null, custom: true };
}

export const newPhysioKind = () => `c${new mongoose.Types.ObjectId().toHexString()}`;
