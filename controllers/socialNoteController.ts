import type { Request, Response } from "express";
import mongoose from "mongoose";
import SocialNote, { SOCIAL_CATEGORIES } from "../models/SocialNote.js";
import Patient from "../models/Patient.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const populate = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) =>
  q.populate("patient", "name lastName").populate("author", "name lastName role");

function parseNote(body: Record<string, unknown>) {
  const category = String(body.category ?? "other");
  if (!SOCIAL_CATEGORIES.includes(category as never)) throw httpError(400, "Nepoznata vrsta beleške.");
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const text = str(body.text, 10000);
  if (!text) throw httpError(400, "Unesite tekst beleške.");
  const day = (v: unknown, label: string) => {
    if (!v) return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw httpError(400, `${label}: neispravan datum.`);
    return d;
  };
  const date = day(body.date, "Datum") ?? new Date();
  if (date.getTime() > Date.now() + 24 * 3_600_000) throw httpError(400, "Datum beleške ne može biti u budućnosti.");
  const followUp = (body.followUp ?? {}) as Record<string, unknown>;
  return {
    category,
    date,
    title: str(body.title, 160),
    text,
    contact: str(body.contact, 200),
    followUpDate: day(followUp.date, "Podsetnik"),
  };
}

// Autor ili uprava
async function editable(req: Request) {
  const note = await SocialNote.findById(param(req, "id")).catch(() => null);
  if (!note) throw httpError(404, "Beleška nije pronađena.");
  if (!isManagerRole(req.user.role) && String(note.author) !== String(req.user._id)) {
    throw httpError(403, "Belešku može da menja samo autor ili uprava.");
  }
  return note;
}

// GET /api/social-notes?patientId=&category=&followUp=open&limit=
export const listNotes = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};
    if (q.patientId) {
      if (!mongoose.isValidObjectId(q.patientId)) throw httpError(400, "Neispravan pacijent.");
      filter.patient = q.patientId;
    }
    if (q.category && SOCIAL_CATEGORIES.includes(q.category as never)) filter.category = q.category;
    if (q.followUp === "open") Object.assign(filter, { "followUp.date": { $ne: null }, "followUp.done": false });
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
    const sort: Record<string, 1 | -1> = q.followUp === "open" ? { "followUp.date": 1 } : { date: -1 };
    const notes = await populate(SocialNote.find(filter).sort(sort).limit(limit));
    res.json({ success: true, notes });
  } catch (err) {
    fail(res, err);
  }
};

export const createNote = async (req: Request, res: Response) => {
  try {
    const patientId = req.body?.patientId;
    if (!mongoose.isValidObjectId(patientId) || !(await Patient.exists({ _id: patientId }))) throw httpError(400, "Izaberite pacijenta.");
    const { followUpDate, ...data } = parseNote(req.body ?? {});
    const note = await SocialNote.create({ ...data, followUp: { date: followUpDate, done: false }, patient: patientId, author: req.user._id });
    res.status(201).json({ success: true, note: await populate(SocialNote.findById(note._id)) });
  } catch (err) {
    fail(res, err);
  }
};

export const updateNote = async (req: Request, res: Response) => {
  try {
    const note = await editable(req);
    const { followUpDate, ...data } = parseNote(req.body ?? {});
    note.set(data);
    // Promena datuma podsetnika ga ponovo otvara
    if (String(followUpDate ?? "") !== String(note.followUp?.date ?? "")) note.set({ followUp: { date: followUpDate, done: false, doneAt: null } });
    await note.save();
    res.json({ success: true, note: await populate(SocialNote.findById(note._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/social-notes/:id/follow-up  { done: boolean }
export const setFollowUpDone = async (req: Request, res: Response) => {
  try {
    const note = await editable(req);
    if (!note.followUp?.date) throw httpError(400, "Beleška nema podsetnik.");
    const done = req.body?.done !== false;
    note.set({ followUp: { date: note.followUp.date, done, doneAt: done ? new Date() : null } });
    await note.save();
    res.json({ success: true, note: await populate(SocialNote.findById(note._id)) });
  } catch (err) {
    fail(res, err);
  }
};

export const deleteNote = async (req: Request, res: Response) => {
  try {
    const note = await editable(req);
    await note.deleteOne();
    res.json({ success: true, message: "Beleška je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};
