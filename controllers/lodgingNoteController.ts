import type { Request, Response } from "express";
import LodgingNote from "../models/LodgingNote.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, message: "Ta napomena već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

const readText = (body: Record<string, unknown> | undefined) => {
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) throw httpError(400, "Upišite tekst napomene.");
  if (text.length > 300) throw httpError(400, "Napomena je predugačka (do 300 znakova).");
  return text;
};

// GET /api/lodging-notes
export const listNotes = async (_req: Request, res: Response) => {
  try {
    const notes = await LodgingNote.find().sort({ text: 1 }).collation({ locale: "sr" });
    res.json({ success: true, notes });
  } catch (err) {
    fail(res, err);
  }
};

export const createNote = async (req: Request, res: Response) => {
  try {
    const note = await LodgingNote.create({ text: readText(req.body), createdBy: req.user._id });
    res.status(201).json({ success: true, note });
  } catch (err) {
    fail(res, err);
  }
};

export const updateNote = async (req: Request, res: Response) => {
  try {
    const note = await LodgingNote.findByIdAndUpdate(param(req, "id"), { $set: { text: readText(req.body) } }, { new: true, runValidators: true });
    if (!note) return res.status(404).json({ success: false, message: "Napomena nije pronađena." });
    res.json({ success: true, note });
  } catch (err) {
    fail(res, err);
  }
};

// Obračuni čuvaju tekst napomene, pa se napomena može slobodno obrisati
export const deleteNote = async (req: Request, res: Response) => {
  try {
    const note = await LodgingNote.findByIdAndDelete(param(req, "id"));
    if (!note) return res.status(404).json({ success: false, message: "Napomena nije pronađena." });
    res.json({ success: true, message: "Napomena je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};
