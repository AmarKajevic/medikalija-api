import type { Request, Response } from "express";
import mongoose from "mongoose";
import NurseEntry, { ENTRY_STATUSES, type EntryStatus } from "../models/NurseEntry.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { acceptEntry, acceptMany, cancelEntry, createEntries, rejectEntry } from "../services/nurseEntries.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const populate = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) =>
  q.populate("createdBy", "name lastName role").populate("reviewedBy", "name lastName").populate("patient", "name lastName");

// POST /api/nurse-entries  { patientId, entries: [{ type, itemId, amount, note, performedAt }] }
export const create = async (req: Request, res: Response) => {
  try {
    const { patientId, entries } = req.body ?? {};
    const result = await createEntries(patientId, entries, req.user);
    const failed = result.applied.filter((a) => !a.ok);
    const pending = result.entries.filter((e) => e.status === "pending").length;
    const message = isManagerRole(req.user.role)
      ? failed.length
        ? `Sačuvano, ali ${failed.length} nije naplaćeno: ${failed.map((f) => f.message).join(" ")}`
        : "Sačuvano."
      : pending
        ? "Poslato upravi na odobrenje."
        : "Zabeleženo.";
    res.status(201).json({ success: true, message, entries: result.entries, applied: result.applied });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/nurse-entries?patientId=&status=pending,accepted&mine=1&from=&to=&limit=
export const list = async (req: Request, res: Response) => {
  try {
    const { patientId, status, mine, from, to } = req.query as Record<string, string | undefined>;
    const manager = isManagerRole(req.user.role);
    if (!manager && !patientId && mine !== "1") {
      return res.status(403).json({ success: false, message: "Izaberite pacijenta." });
    }

    const filter: Record<string, unknown> = {};
    if (patientId) {
      if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ success: false, message: "Neispravan pacijent." });
      filter.patient = patientId;
    }
    if (mine === "1") filter.createdBy = req.user._id;
    if (status) {
      const statuses = status.split(",").filter((s): s is EntryStatus => ENTRY_STATUSES.includes(s as EntryStatus));
      // "processing" se prikazuje kao da još čeka
      filter.status = { $in: statuses.includes("pending") ? [...statuses, "processing"] : statuses };
    }
    const range: Record<string, Date> = {};
    if (from && !Number.isNaN(Date.parse(from))) range.$gte = new Date(from);
    if (to && !Number.isNaN(Date.parse(to))) range.$lte = new Date(to);
    if (Object.keys(range).length) filter.performedAt = range;

    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    const entries = await populate(NurseEntry.find(filter).sort({ performedAt: -1 }).limit(limit));
    res.json({ success: true, entries });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/nurse-entries/pending-summary  → ukupno i po pacijentu (za meni i profil)
export const pendingSummary = async (_req: Request, res: Response) => {
  try {
    const rows = await NurseEntry.aggregate<{ _id: mongoose.Types.ObjectId; count: number; oldest: Date }>([
      { $match: { status: { $in: ["pending", "processing"] } } },
      { $group: { _id: "$patient", count: { $sum: 1 }, oldest: { $min: "$performedAt" } } },
      { $sort: { oldest: 1 } },
    ]);
    res.json({
      success: true,
      total: rows.reduce((s, r) => s + r.count, 0),
      byPatient: rows.map((r) => ({ patientId: r._id, count: r.count, oldest: r.oldest })),
    });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/nurse-entries/:id/accept  { amount? }
export const accept = async (req: Request, res: Response) => {
  try {
    const result = await acceptEntry(param(req, "id"), req.user, req.body?.amount);
    res.json({ success: true, message: result.message, entry: result.ok ? result.entry : null });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/nurse-entries/accept  { items: [{ id, amount? }] }
export const acceptBulk = async (req: Request, res: Response) => {
  try {
    const results = await acceptMany(req.body?.items, req.user);
    const ok = results.filter((r) => r.ok).length;
    res.json({
      success: true,
      message: ok === results.length ? `Prihvaćeno: ${ok}.` : `Prihvaćeno ${ok} od ${results.length}.`,
      results: results.map((r) => ({ id: r.id, ok: r.ok, message: r.message })),
    });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/nurse-entries/:id/reject  { reason? }
export const reject = async (req: Request, res: Response) => {
  try {
    const entry = await rejectEntry(param(req, "id"), req.user, req.body?.reason);
    res.json({ success: true, message: "Unos je odbijen.", entry });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/nurse-entries/:id
export const cancel = async (req: Request, res: Response) => {
  try {
    await cancelEntry(param(req, "id"), req.user);
    res.json({ success: true, message: "Unos je povučen." });
  } catch (err) {
    fail(res, err);
  }
};
