import type { Request, Response } from "express";
import mongoose from "mongoose";
import MedicalReport, { REPORT_TYPES, type ReportType } from "../models/MedicalReport.js";
import Patient from "../models/Patient.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const populate = <Q extends { populate: (path: string, select: string) => Q }>(q: Q) =>
  q.populate("patient", "name lastName dateOfBirth").populate("author", "name lastName role").populate("addenda.author", "name lastName");

const text = (v: unknown, max: number, field: string) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw httpError(400, `Polje "${field}" mora biti tekst.`);
  if (v.length > max) throw httpError(400, `Polje "${field}" je predugačko.`);
  return v.trim();
};

const num = (v: unknown, min: number, max: number, label: string) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${label}: vrednost mora biti od ${min} do ${max}.`);
  return Math.round(n * 10) / 10;
};

const date = (v: unknown, label: string, required = false) => {
  if (v === undefined || v === null || v === "") {
    if (required) throw httpError(400, `${label} je obavezan.`);
    return null;
  }
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw httpError(400, `${label}: neispravan datum.`);
  return d;
};

// Proverava i čisti telo zahteva (pacijent se postavlja samo pri kreiranju)
function parseReport(body: Record<string, unknown>) {
  const type = (body.type ?? "exam") as ReportType;
  if (!REPORT_TYPES.includes(type)) throw httpError(400, "Nepoznata vrsta izveštaja.");

  const visitDate = date(body.visitDate, "Datum pregleda", true)!;
  if (visitDate.getTime() > Date.now() + 24 * 3_600_000) throw httpError(400, "Datum pregleda ne može biti u budućnosti.");

  const v = (body.vitals ?? {}) as Record<string, unknown>;
  const bp = text(v.bloodPressure, 15, "Pritisak");
  if (bp && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(bp)) throw httpError(400, "Pritisak upišite kao 130/85.");

  const rawDiagnoses = Array.isArray(body.diagnoses) ? body.diagnoses : [];
  if (rawDiagnoses.length > 30) throw httpError(400, "Previše dijagnoza.");
  const diagnoses = rawDiagnoses.map((d) => {
    const item = (d ?? {}) as Record<string, unknown>;
    const name = text(item.name, 200, "Dijagnoza");
    const code = text(item.code, 10, "Šifra").toUpperCase();
    if (!name) throw httpError(400, "Dijagnoza mora imati naziv.");
    if (code && !/^[A-Z]\d{2}(\.\d{1,2})?$/.test(code)) throw httpError(400, `Šifra "${code}" nije u MKB-10 obliku (npr. I10 ili N39.0).`);
    return { code, name };
  });

  const followUp = (body.followUp ?? {}) as Record<string, unknown>;
  const appointment = (body.appointment ?? {}) as Record<string, unknown>;
  if (appointment.eventId && !mongoose.isValidObjectId(appointment.eventId)) throw httpError(400, "Neispravan termin.");

  return {
    type,
    visitDate,
    vitals: {
      bloodPressure: bp.replace(/\s/g, ""),
      pulse: num(v.pulse, 20, 250, "Puls"),
      temperature: num(v.temperature, 30, 43, "Temperatura"),
      spo2: num(v.spo2, 50, 100, "Saturacija"),
      glucose: num(v.glucose, 0.5, 40, "Šećer"),
      weight: num(v.weight, 20, 300, "Težina"),
    },
    anamnesis: text(body.anamnesis, 10000, "Anamneza"),
    findings: text(body.findings, 10000, "Nalaz"),
    diagnoses,
    therapy: text(body.therapy, 10000, "Terapija"),
    conclusion: text(body.conclusion, 10000, "Zaključak"),
    followUp: { date: date(followUp.date, "Datum kontrole"), note: text(followUp.note, 500, "Napomena za kontrolu") },
    appointment: {
      eventId: appointment.eventId ? String(appointment.eventId) : null,
      occurrenceStart: date(appointment.occurrenceStart, "Termin"),
    },
  };
}

/** Nacrte vidi samo autor; potpisane celo zdravstveno osoblje */
const visibleTo = (req: Request) => ({ $or: [{ status: "signed" }, { author: req.user._id }] });

async function ownDraft(req: Request) {
  const report = await MedicalReport.findById(param(req, "id")).catch(() => null);
  if (!report) throw httpError(404, "Izveštaj nije pronađen.");
  if (String(report.author) !== String(req.user._id)) throw httpError(403, "Izveštaj može da menja samo doktor koji ga je napisao.");
  if (report.status !== "draft") throw httpError(409, "Potpisan izveštaj se ne menja — dodajte dopunu.");
  return report;
}

// GET /api/medical-reports?patientId=&mine=1&status=draft|signed&from=&to=&eventId=&limit=
export const listReports = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { ...visibleTo(req) };
    if (q.patientId) {
      if (!mongoose.isValidObjectId(q.patientId)) throw httpError(400, "Neispravan pacijent.");
      filter.patient = q.patientId;
    }
    if (q.mine === "1") filter.author = req.user._id;
    if (q.status === "draft" || q.status === "signed") filter.status = q.status;
    if (q.eventId && mongoose.isValidObjectId(q.eventId)) filter["appointment.eventId"] = q.eventId;
    const range: Record<string, Date> = {};
    if (q.from && !Number.isNaN(Date.parse(q.from))) range.$gte = new Date(q.from);
    if (q.to && !Number.isNaN(Date.parse(q.to))) range.$lte = new Date(q.to);
    if (Object.keys(range).length) filter.visitDate = range;

    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
    const reports = await populate(MedicalReport.find(filter).sort({ visitDate: -1 }).limit(limit));
    res.json({ success: true, reports });
  } catch (err) {
    fail(res, err);
  }
};

export const getReport = async (req: Request, res: Response) => {
  try {
    const report = await populate(MedicalReport.findOne({ _id: param(req, "id"), ...visibleTo(req) })).catch(() => null);
    if (!report) return res.status(404).json({ success: false, message: "Izveštaj nije pronađen." });
    res.json({ success: true, report });
  } catch (err) {
    fail(res, err);
  }
};

export const createReport = async (req: Request, res: Response) => {
  try {
    const patientId = req.body?.patientId;
    if (!mongoose.isValidObjectId(patientId) || !(await Patient.exists({ _id: patientId }))) throw httpError(400, "Izaberite pacijenta.");
    const report = await MedicalReport.create({ ...parseReport(req.body ?? {}), patient: patientId, author: req.user._id });
    res.status(201).json({ success: true, report: await populate(MedicalReport.findById(report._id)) });
  } catch (err) {
    fail(res, err);
  }
};

export const updateReport = async (req: Request, res: Response) => {
  try {
    const report = await ownDraft(req);
    report.set(parseReport(req.body ?? {}));
    await report.save();
    res.json({ success: true, report: await populate(MedicalReport.findById(report._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// Potpisivanje zaključava izveštaj
export const signReport = async (req: Request, res: Response) => {
  try {
    const report = await ownDraft(req);
    if (!report.findings && !report.conclusion && report.diagnoses.length === 0) {
      throw httpError(400, "Pre potpisivanja upišite nalaz, dijagnozu ili zaključak.");
    }
    const signed = await MedicalReport.findOneAndUpdate(
      { _id: report._id, status: "draft" },
      { $set: { status: "signed", signedAt: new Date() } },
      { new: true }
    );
    if (!signed) throw httpError(409, "Izveštaj je već potpisan.");
    res.json({ success: true, report: await populate(MedicalReport.findById(report._id)) });
  } catch (err) {
    fail(res, err);
  }
};

// Dopuna potpisanog izveštaja (bilo koji doktor)
export const addAddendum = async (req: Request, res: Response) => {
  try {
    const value = text(req.body?.text, 5000, "Dopuna");
    if (!value) throw httpError(400, "Unesite tekst dopune.");
    const report = await MedicalReport.findOneAndUpdate(
      { _id: param(req, "id"), status: "signed" },
      { $push: { addenda: { text: value, author: req.user._id } } },
      { new: true }
    ).catch(() => null);
    if (!report) throw httpError(409, "Dopuna se dodaje samo potpisanom izveštaju.");
    res.status(201).json({ success: true, report: await populate(MedicalReport.findById(report._id)) });
  } catch (err) {
    fail(res, err);
  }
};

export const deleteReport = async (req: Request, res: Response) => {
  try {
    const report = await ownDraft(req);
    await MedicalReport.deleteOne({ _id: report._id, status: "draft" });
    res.json({ success: true, message: "Nacrt je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};
