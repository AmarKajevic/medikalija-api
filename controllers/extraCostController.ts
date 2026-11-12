import type { Request, Response } from "express";
import ExtraCost from "../models/ExtraCost.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { round2 } from "../services/specificationCharges.js";

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, message: "Trošak sa tim nazivom već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

// Proverava i čisti polja; `partial` za izmenu (samo poslata polja)
function readCost(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw httpError(400, "Naziv troška je obavezan.");
    if (name.length > 160) throw httpError(400, "Naziv je predugačak.");
    out.name = name;
  }
  if (!partial || body.priceRSD !== undefined) {
    const price = Number(body.priceRSD);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, "Cena mora biti 0 ili veća.");
    out.priceRSD = round2(price);
  }
  if (body.active !== undefined) out.active = !!body.active;
  return out;
}

// GET /api/extra-costs?all=1 (podrazumevano samo aktivni)
export const listExtraCosts = async (req: Request, res: Response) => {
  try {
    const costs = await ExtraCost.find(req.query.all === "1" ? {} : { active: true }).sort({ name: 1 }).collation({ locale: "sr" });
    res.json({ success: true, costs });
  } catch (err) {
    fail(res, err);
  }
};

export const createExtraCost = async (req: Request, res: Response) => {
  try {
    const cost = await ExtraCost.create({ ...readCost(req.body ?? {}, false), createdBy: req.user._id });
    res.status(201).json({ success: true, cost });
  } catch (err) {
    fail(res, err);
  }
};

export const updateExtraCost = async (req: Request, res: Response) => {
  try {
    const cost = await ExtraCost.findByIdAndUpdate(param(req, "id"), { $set: readCost(req.body ?? {}, true) }, { new: true, runValidators: true });
    if (!cost) return res.status(404).json({ success: false, message: "Trošak nije pronađen." });
    res.json({ success: true, cost });
  } catch (err) {
    fail(res, err);
  }
};

// Specifikacije čuvaju naziv i iznos, pa se trošak iz cenovnika može slobodno obrisati
export const deleteExtraCost = async (req: Request, res: Response) => {
  try {
    const cost = await ExtraCost.findByIdAndDelete(param(req, "id"));
    if (!cost) return res.status(404).json({ success: false, message: "Trošak nije pronađen." });
    res.json({ success: true, message: "Trošak je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};
