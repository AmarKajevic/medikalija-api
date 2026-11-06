import type { Request, Response } from "express";
import mongoose from "mongoose";
import CareTask from "../models/CareTask.js";
import Article from "../models/Articles.js";
import NurseEntry from "../models/NurseEntry.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, message: "Usluga sa tim nazivom već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

// Proverava i čisti polja iz zahteva; `partial` za izmenu (samo poslata polja)
async function readTask(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw httpError(400, "Naziv usluge je obavezan.");
    if (name.length > 120) throw httpError(400, "Naziv je predugačak.");
    out.name = name;
  }
  if (body.category !== undefined) out.category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 60) : "Nega";
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) throw httpError(400, "Cena mora biti 0 ili veća.");
    out.price = Math.round(price * 100) / 100;
  }
  if (body.articleAmount !== undefined) {
    const amount = Number(body.articleAmount);
    if (!Number.isFinite(amount) || amount < 0) throw httpError(400, "Količina artikla mora biti 0 ili veća.");
    out.articleAmount = Math.round(amount * 100) / 100;
  }
  if (body.article !== undefined) {
    if (body.article === null || body.article === "") out.article = null;
    else {
      if (!mongoose.isValidObjectId(body.article) || !(await Article.exists({ _id: body.article }))) {
        throw httpError(400, "Izabrani artikal ne postoji.");
      }
      out.article = body.article;
    }
  }
  if (body.active !== undefined) out.active = !!body.active;
  if (body.sortOrder !== undefined) out.sortOrder = Number(body.sortOrder) || 0;
  return out;
}

// GET /api/care-tasks?all=1  (sestre vide samo aktivne)
export const listTasks = async (req: Request, res: Response) => {
  try {
    const all = req.query.all === "1" && isManagerRole(req.user.role);
    const tasks = await CareTask.find(all ? {} : { active: true })
      .sort({ category: 1, sortOrder: 1, name: 1 })
      .collation({ locale: "sr" })
      .populate("article", "name price");
    res.json({ success: true, tasks });
  } catch (err) {
    fail(res, err);
  }
};

export const createTask = async (req: Request, res: Response) => {
  try {
    const data = await readTask(req.body ?? {}, false);
    const task = await CareTask.create({ ...data, createdBy: req.user._id });
    res.status(201).json({ success: true, task: await task.populate("article", "name price") });
  } catch (err) {
    fail(res, err);
  }
};

export const updateTask = async (req: Request, res: Response) => {
  try {
    const data = await readTask(req.body ?? {}, true);
    const task = await CareTask.findByIdAndUpdate(param(req, "id"), { $set: data }, { new: true, runValidators: true }).populate("article", "name price");
    if (!task) return res.status(404).json({ success: false, message: "Usluga nije pronađena." });
    res.json({ success: true, task });
  } catch (err) {
    fail(res, err);
  }
};

// Usluga koja je već korišćena se arhivira (istorija nege je zadržava), ostale se brišu
export const deleteTask = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const used = await NurseEntry.exists({ careTask: id });
    if (used) {
      const task = await CareTask.findByIdAndUpdate(id, { $set: { active: false } }, { new: true });
      if (!task) return res.status(404).json({ success: false, message: "Usluga nije pronađena." });
      return res.json({ success: true, archived: true, message: "Usluga je korišćena, pa je arhivirana (više se ne nudi sestrama)." });
    }
    const deleted = await CareTask.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ success: false, message: "Usluga nije pronađena." });
    res.json({ success: true, archived: false, message: "Usluga je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};
