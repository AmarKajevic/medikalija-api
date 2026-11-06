import type { Request, Response } from "express";
import Analysis from "../models/Analysis.js";
import { errorMessage } from "../utils/errors.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { param } from "../utils/http.js";

// Šifarnik laboratorijskih analiza (naziv + cena).

const parseInput = (body: { name?: unknown; price?: unknown }) => {
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const price = body.price === undefined || body.price === "" ? undefined : Number(body.price);
  return { name, price };
};

const nameTaken = (name: string, exceptId?: string) =>
  Analysis.exists({ name: new RegExp(`^${escapeRegex(name)}$`, "i"), ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

export const addAnalysis = async (req: Request, res: Response) => {
  try {
    const { name, price } = parseInput(req.body);
    if (!name) return res.status(400).json({ success: false, message: "Naziv analize je obavezan." });
    if (price === undefined || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ success: false, message: "Neispravna cena." });
    }
    if (await nameTaken(name)) return res.status(409).json({ success: false, message: "Analiza sa tim nazivom već postoji." });

    const analysis = await Analysis.create({ name, price, createdBy: req.user._id });
    return res.status(201).json({ success: true, analysis });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

// Menja naziv i/ili cenu. (Ranije se naziv tiho ignorisao.)
export const updateAnalysis = async (req: Request, res: Response) => {
  try {
    const analysisId = param(req, "analysisId");
    const { name, price } = parseInput(req.body);
    const update: { name?: string; price?: number } = {};

    if (name !== undefined) {
      if (!name) return res.status(400).json({ success: false, message: "Naziv ne može biti prazan." });
      if (await nameTaken(name, analysisId)) {
        return res.status(409).json({ success: false, message: "Analiza sa tim nazivom već postoji." });
      }
      update.name = name;
    }
    if (price !== undefined) {
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, message: "Neispravna cena." });
      update.price = price;
    }

    const analysis = await Analysis.findByIdAndUpdate(analysisId, update, { new: true });
    if (!analysis) return res.status(404).json({ success: false, message: "Analiza nije pronađena." });
    return res.status(200).json({ success: true, analysis, newAnalysis: analysis });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

export const deleteAnalysis = async (req: Request, res: Response) => {
  try {
    const deleted = await Analysis.findByIdAndDelete(param(req, "analysisId"));
    if (!deleted) return res.status(404).json({ success: false, message: "Analiza nije pronađena." });
    return res.status(200).json({ success: true, deleteAnalysis: deleted });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

export const getAnalyses = async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const filter = search ? { name: new RegExp(escapeRegex(search), "i") } : {};
    const analyses = await Analysis.find(filter).sort({ name: 1 });
    return res.status(200).json({ success: true, analyses });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

export const getAnalysis = async (req: Request, res: Response) => {
  try {
    const analysis = await Analysis.findById(param(req, "analysisId"));
    if (!analysis) return res.status(404).json({ success: false, message: "Analiza nije pronađena." });
    return res.status(200).json({ success: true, analysis });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};
