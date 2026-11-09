import type { Request, Response } from "express";
import ProfessionalService from "../models/ProfessionalService.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { resolveTargetSpecification } from "../services/getOrCreateActiveSpecification.js";
import { addServiceCharge, round2 } from "../services/specificationCharges.js";

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    return res.status(409).json({ success: false, message: "Usluga sa tim nazivom već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

// Proverava i čisti polja; `partial` za izmenu (samo poslata polja)
function readService(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw httpError(400, "Naziv usluge je obavezan.");
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

// GET /api/professional-services?all=1 (podrazumevano samo aktivne)
export const listServices = async (req: Request, res: Response) => {
  try {
    const services = await ProfessionalService.find(req.query.all === "1" ? {} : { active: true }).sort({ name: 1 }).collation({ locale: "sr" });
    res.json({ success: true, services });
  } catch (err) {
    fail(res, err);
  }
};

export const createService = async (req: Request, res: Response) => {
  try {
    const service = await ProfessionalService.create({ ...readService(req.body ?? {}, false), createdBy: req.user._id });
    res.status(201).json({ success: true, service });
  } catch (err) {
    fail(res, err);
  }
};

export const updateService = async (req: Request, res: Response) => {
  try {
    const service = await ProfessionalService.findByIdAndUpdate(param(req, "id"), { $set: readService(req.body ?? {}, true) }, { new: true, runValidators: true });
    if (!service) return res.status(404).json({ success: false, message: "Usluga nije pronađena." });
    res.json({ success: true, service });
  } catch (err) {
    fail(res, err);
  }
};

// Specifikacije čuvaju naziv i cenu, pa se usluga može slobodno obrisati
export const deleteService = async (req: Request, res: Response) => {
  try {
    const service = await ProfessionalService.findByIdAndDelete(param(req, "id"));
    if (!service) return res.status(404).json({ success: false, message: "Usluga nije pronađena." });
    res.json({ success: true, message: "Usluga je obrisana." });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/professional-services/charge { patientId, serviceId, amount?, specificationId? }
// Dodaje uslugu u specifikaciju (izabran period ili aktivan); cena = cena iz cenovnika × broj puta
export const chargeService = async (req: Request, res: Response) => {
  try {
    const { patientId, serviceId, specificationId } = req.body ?? {};
    const times = req.body?.amount === undefined ? 1 : round2(req.body.amount);
    if (!(times > 0) || times > 1000) throw httpError(400, "Broj puta mora biti veći od nule.");
    const service = await ProfessionalService.findById(String(serviceId ?? "")).catch(() => null);
    if (!service || !service.active) throw httpError(404, "Usluga nije pronađena.");
    const spec = await resolveTargetSpecification(String(patientId ?? ""), { specificationId });
    const { specification } = await addServiceCharge(spec, { name: service.name, times, unitPrice: service.priceRSD, createdBy: req.user._id, category: "professional" });
    res.status(201).json({ success: true, specification, message: `Dodato: ${service.name}.` });
  } catch (err) {
    fail(res, err);
  }
};
