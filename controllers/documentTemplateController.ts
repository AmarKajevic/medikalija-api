import type { Request, Response } from "express";
import AuditLog from "../models/AuditLog.js";
import DocumentTemplate, { TEMPLATE_MAX_BYTES } from "../models/DocumentTemplate.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const populate = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) => q.populate("uploadedBy", "name lastName role");

async function templateOr404(req: Request) {
  const t = await DocumentTemplate.findById(param(req, "id")).catch(() => null);
  if (!t) throw httpError(404, "Šablon nije pronađen.");
  return t;
}

/** .docx je ZIP (počinje sa "PK") i sadrži word/document.xml */
function parseDocx(base64: unknown): Buffer {
  if (typeof base64 !== "string" || !base64) throw httpError(400, "Izaberite Word fajl (.docx).");
  const data = Buffer.from(base64, "base64");
  if (data.length > TEMPLATE_MAX_BYTES) throw httpError(413, "Šablon je veći od 2 MB.");
  if (data.length < 4 || data[0] !== 0x50 || data[1] !== 0x4b || !data.includes(Buffer.from("word/document.xml"))) {
    throw httpError(400, "Fajl nije Word dokument (.docx). Stari .doc format sačuvajte u Wordu kao .docx.");
  }
  return data;
}

// GET /api/social/templates
export const listTemplates = async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, templates: await populate(DocumentTemplate.find().sort({ name: 1 })) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/social/templates { name, description, fileName, data (base64) }
export const createTemplate = async (req: Request, res: Response) => {
  try {
    const fileName = str(req.body?.fileName, 200);
    if (!/\.docx$/i.test(fileName)) throw httpError(400, "Šablon mora biti Word fajl (.docx).");
    const data = parseDocx(req.body?.data);
    const name = str(req.body?.name, 120) || fileName.replace(/\.docx$/i, "");
    const t = await DocumentTemplate.create({ name, description: str(req.body?.description, 300), fileName, size: data.length, data, uploadedBy: req.user._id });
    await AuditLog.create({ action: "template.create", user: req.user._id, summary: name });
    res.status(201).json({ success: true, template: await populate(DocumentTemplate.findById(t._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /api/social/templates/:id { name?, description?, fileName?, data? } — novi fajl zamenjuje stari
export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const t = await templateOr404(req);
    if (req.body?.name !== undefined) {
      const name = str(req.body.name, 120);
      if (!name) throw httpError(400, "Unesite naziv šablona.");
      t.name = name;
    }
    if (req.body?.description !== undefined) t.description = str(req.body.description, 300);
    if (req.body?.data !== undefined) {
      const fileName = str(req.body?.fileName, 200);
      if (!/\.docx$/i.test(fileName)) throw httpError(400, "Šablon mora biti Word fajl (.docx).");
      const data = parseDocx(req.body.data);
      t.set({ data, size: data.length, fileName });
    }
    await t.save();
    await AuditLog.create({ action: "template.update", user: req.user._id, summary: t.name });
    res.json({ success: true, template: await populate(DocumentTemplate.findById(t._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/social/templates/:id/file — sam .docx (za popunjavanje u pregledaču)
export const downloadTemplate = async (req: Request, res: Response) => {
  try {
    const t = await DocumentTemplate.findById(param(req, "id")).select("+data fileName").catch(() => null);
    if (!t) throw httpError(404, "Šablon nije pronađen.");
    res.setHeader("Content-Type", DOCX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(t.fileName)}`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(t.data);
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/social/templates/:id
export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const t = await templateOr404(req);
    await t.deleteOne();
    await AuditLog.create({ action: "template.delete", user: req.user._id, summary: t.name });
    res.json({ success: true, message: "Šablon je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};
