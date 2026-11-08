import type { Request, Response } from "express";
import LodgingPrice from "../models/LodgingPrice.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, message: "Cena sa tim nazivom već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

// Proverava i čisti polja; `partial` za izmenu (samo poslata polja)
function readPrice(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw httpError(400, "Naziv je obavezan (npr. „30 dana”).");
    if (name.length > 80) throw httpError(400, "Naziv je predugačak.");
    out.name = name;
  }
  if (!partial || body.priceEUR !== undefined) {
    const price = Number(body.priceEUR);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, "Cena mora biti 0 ili veća.");
    out.priceEUR = Math.round(price * 100) / 100;
  }
  if (body.days !== undefined) {
    if (body.days === null || body.days === "") out.days = null;
    else {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 0) throw httpError(400, "Broj dana mora biti ceo broj.");
      out.days = days;
    }
  }
  if (body.active !== undefined) out.active = !!body.active;
  return out;
}

// GET /api/lodging-prices?all=1 (podrazumevano samo aktivne)
export const listPrices = async (req: Request, res: Response) => {
  try {
    const prices = await LodgingPrice.find(req.query.all === "1" ? {} : { active: true })
      .sort({ days: 1, priceEUR: 1, name: 1 })
      .collation({ locale: "sr" });
    res.json({ success: true, prices });
  } catch (err) {
    fail(res, err);
  }
};

export const createPrice = async (req: Request, res: Response) => {
  try {
    const price = await LodgingPrice.create({ ...readPrice(req.body ?? {}, false), createdBy: req.user._id });
    res.status(201).json({ success: true, price });
  } catch (err) {
    fail(res, err);
  }
};

export const updatePrice = async (req: Request, res: Response) => {
  try {
    const price = await LodgingPrice.findByIdAndUpdate(param(req, "id"), { $set: readPrice(req.body ?? {}, true) }, { new: true, runValidators: true });
    if (!price) return res.status(404).json({ success: false, message: "Cena nije pronađena." });
    res.json({ success: true, price });
  } catch (err) {
    fail(res, err);
  }
};

// Obračuni čuvaju iznos i naziv, pa se cena može slobodno obrisati
export const deletePrice = async (req: Request, res: Response) => {
  try {
    const price = await LodgingPrice.findByIdAndDelete(param(req, "id"));
    if (!price) return res.status(404).json({ success: false, message: "Cena nije pronađena." });
    res.json({ success: true, message: "Cena je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};
