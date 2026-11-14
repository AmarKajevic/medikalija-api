import DiagnosisTemplate from "../models/DiagnosisTemplate.js";
import type { Request, Response } from "express";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

// Šabloni za medicinsko osoblje: gotovi tekstovi koje sestre biraju pri unosu učinka rada.
// Pravi ih i menja uprava (admin, glavna sestra); čitaju ih svi prijavljeni.

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

function readTemplate(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!name || !description) throw httpError(400, "Unesite naziv i tekst šablona.");
  if (name.length > 120) throw httpError(400, "Naziv je predugačak.");
  if (description.length > 4000) throw httpError(400, "Tekst je predugačak.");
  return { name, description };
}

const addDiagnosisTemplate = async (req: Request, res: Response) => {
  try {
    const template = await DiagnosisTemplate.create({ ...readTemplate(req.body ?? {}), createdBy: req.user._id });
    return res.status(201).json({ success: true, message: "Šablon je dodat.", template });
  } catch (err) {
    return fail(res, err);
  }
};

const getDiagnosisTemplate = async (_req: Request, res: Response) => {
  try {
    const diagnosisTemplates = await DiagnosisTemplate.find().populate("createdBy", "role name");
    return res.status(200).json({ success: true, diagnosisTemplates });
  } catch (err) {
    return fail(res, err);
  }
};

// PUT /api/diagnosisTemplate/:id { name, description }
const updateDiagnosisTemplate = async (req: Request, res: Response) => {
  try {
    const template = await DiagnosisTemplate.findByIdAndUpdate(param(req, "id"), { $set: readTemplate(req.body ?? {}) }, { new: true, runValidators: true }).catch(() => null);
    if (!template) return res.status(404).json({ success: false, message: "Šablon nije pronađen." });
    return res.json({ success: true, message: "Šablon je izmenjen.", template });
  } catch (err) {
    return fail(res, err);
  }
};

// DELETE /api/diagnosisTemplate/:id — već upisan učinak rada zadržava svoj tekst
const deleteDiagnosisTemplate = async (req: Request, res: Response) => {
  try {
    const template = await DiagnosisTemplate.findByIdAndDelete(param(req, "id")).catch(() => null);
    if (!template) return res.status(404).json({ success: false, message: "Šablon nije pronađen." });
    return res.json({ success: true, message: "Šablon je obrisan." });
  } catch (err) {
    return fail(res, err);
  }
};

export { addDiagnosisTemplate, getDiagnosisTemplate, updateDiagnosisTemplate, deleteDiagnosisTemplate };
