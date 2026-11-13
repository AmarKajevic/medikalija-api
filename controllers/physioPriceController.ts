import type { Request, Response } from "express";
import PhysioPrice from "../models/PhysioPrice.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { findPhysioKind, isBuiltInPhysioKind, listPhysioKinds, newPhysioKind } from "../services/physioKinds.js";
import { resolveTargetSpecification } from "../services/getOrCreateActiveSpecification.js";
import { addServiceCharge, round2 } from "../services/specificationCharges.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const readPrice = (v: unknown) => {
  const price = Number(v);
  if (v === "" || v == null || !Number.isFinite(price) || price < 0) throw httpError(400, "Cena mora biti 0 ili veća.");
  return round2(price);
};

const readName = async (v: unknown, exceptKind?: string) => {
  const name = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!name) throw httpError(400, "Unesite naziv terapije.");
  if (name.length > 160) throw httpError(400, "Naziv je predugačak.");
  const same = (await listPhysioKinds()).find((k) => k.kind !== exceptKind && k.name.toLowerCase() === name.toLowerCase());
  if (same) throw httpError(409, "Terapija sa tim nazivom već postoji.");
  return name;
};

// GET /api/physio-prices → sve vrste sa cenom (null = još nije uneta)
export const listPhysioPrices = async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, prices: await listPhysioKinds() });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/physio-prices/kinds → samo vrste i nazivi (za fizioterapeuta, bez cena)
export const listPhysioKindNames = async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, kinds: (await listPhysioKinds()).map(({ kind, name }) => ({ kind, name })) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/physio-prices { name, priceRSD } — nova vrsta fizikalne terapije (admin)
export const createPhysioKind = async (req: Request, res: Response) => {
  try {
    const name = await readName(req.body?.name);
    const priceRSD = readPrice(req.body?.priceRSD);
    const saved = await PhysioPrice.create({ kind: newPhysioKind(), name, priceRSD, updatedBy: req.user._id });
    res.status(201).json({ success: true, price: { kind: saved.kind, name, priceRSD, custom: true } });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /api/physio-prices/:kind { priceRSD, name? } — cena i naziv (i kod osnovnih vrsta)
export const setPhysioPrice = async (req: Request, res: Response) => {
  try {
    const current = await findPhysioKind(param(req, "kind"));
    const set: Record<string, unknown> = { priceRSD: readPrice(req.body?.priceRSD), updatedBy: req.user._id };
    if (req.body?.name !== undefined) set.name = await readName(req.body.name, current.kind);
    const saved = await PhysioPrice.findOneAndUpdate({ kind: current.kind }, { $set: set }, { new: true, upsert: true, runValidators: true });
    res.json({ success: true, price: saved });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/physio-prices/:kind — briše vrstu terapije (i osnovnu). Već naplaćene stavke čuvaju naziv i cenu.
export const deletePhysioKind = async (req: Request, res: Response) => {
  try {
    const current = await findPhysioKind(param(req, "kind")).catch(() => null);
    if (!current) throw httpError(404, "Terapija nije pronađena.");
    // Osnovna vrsta ostaje zapamćena kao obrisana (inače bi se ponovo pojavila); dodata se briše iz baze
    if (isBuiltInPhysioKind(current.kind)) {
      await PhysioPrice.findOneAndUpdate({ kind: current.kind }, { $set: { deleted: true, updatedBy: req.user._id } }, { upsert: true });
    } else {
      await PhysioPrice.deleteOne({ kind: current.kind });
    }
    res.json({ success: true, message: "Terapija je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/physio-prices/charge { patientId, kind, amount?, specificationId? }
// Uprava dodaje vanrednu fizikalnu terapiju direktno u specifikaciju (izabran period ili aktivan);
// cena = cena iz cenovnika fizioterapije × broj puta
export const chargePhysio = async (req: Request, res: Response) => {
  try {
    const { patientId, kind, specificationId } = req.body ?? {};
    const physio = await findPhysioKind(kind);
    const times = req.body?.amount === undefined ? 1 : round2(req.body.amount);
    if (!(times > 0) || times > 1000) throw httpError(400, "Broj puta mora biti veći od nule.");
    if (physio.priceRSD == null) throw httpError(400, `Cena za „${physio.name}” nije uneta. Admin je unosi u „Cene fizioterapije”.`);
    const spec = await resolveTargetSpecification(String(patientId ?? ""), { specificationId });
    const name = `${physio.name} (vanredna)`;
    const { specification } = await addServiceCharge(spec, { name, times, unitPrice: physio.priceRSD, createdBy: req.user._id, category: "physio" });
    res.status(201).json({ success: true, specification, message: `Dodato: ${name}.` });
  } catch (err) {
    fail(res, err);
  }
};
