import type { Request, Response } from "express";
import PhysioPrice from "../models/PhysioPrice.js";
import { PHYSIO_KINDS, type PhysioKind } from "../models/NurseEntry.js";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

// GET /api/physio-prices → cena za svaku vrstu terapije (null = još nije uneta)
export const listPhysioPrices = async (_req: Request, res: Response) => {
  try {
    const rows = await PhysioPrice.find().lean();
    const prices = PHYSIO_KINDS.map((kind) => ({ kind, priceRSD: rows.find((r) => r.kind === kind)?.priceRSD ?? null }));
    res.json({ success: true, prices });
  } catch (err) {
    res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// PUT /api/physio-prices/:kind { priceRSD }
export const setPhysioPrice = async (req: Request, res: Response) => {
  try {
    const kind = param(req, "kind") as PhysioKind;
    if (!PHYSIO_KINDS.includes(kind)) return res.status(400).json({ success: false, message: "Nepoznata vrsta terapije." });
    const price = Number(req.body?.priceRSD);
    if (req.body?.priceRSD === "" || req.body?.priceRSD == null || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ success: false, message: "Cena mora biti 0 ili veća." });
    }
    const saved = await PhysioPrice.findOneAndUpdate(
      { kind },
      { $set: { priceRSD: Math.round(price * 100) / 100, updatedBy: req.user._id } },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    res.json({ success: true, price: { kind, priceRSD: saved!.priceRSD } });
  } catch (err) {
    res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};
