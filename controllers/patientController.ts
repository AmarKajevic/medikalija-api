import Patient from "../models/Patient.js"
import Specification from "../models/Specification.js";
import { normalizeStoredDay, parseCalendarDay, sameDayQuery } from "../utils/dateUtils.js";
import type { Request, Response } from "express";
import { errorMessage, statusOf } from "../utils/errors.js";
import NurseEntry from "../models/NurseEntry.js";
import Diagnosis from "../models/Diagnosis.js";
import UsedMedicine from "../models/UsedMedicine.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedCombinations from "../models/UsedCombinations.js";
import MedicalReport from "../models/MedicalReport.js";
import SocialNote from "../models/SocialNote.js";
import SocialDocument from "../models/SocialDocument.js";
import SocialProfile from "../models/SocialProfile.js";
import CalendarEvent from "../models/CalendarEvent.js";
import PatientMedicine from "../models/PatientMedicine.js";
import PatientArticle from "../models/PatientArticle.js";
import MedicineReserve from "../models/medicineReserve.js";
import AuditLog from "../models/AuditLog.js";
import { param } from "../utils/http.js";
import { PATIENT_EDIT_ROLES, PATIENT_PURGE_ROLES } from "../middleware/requireRole.js";
import { assertUniquePatientName, patientNameKey } from "../services/patientIdentity.js";

// Koliko zapisa (dokumentacije) pacijent ima: specifikacije sa stavkama, unosi, izveštaji, beleške, zalihe.
// Pacijent bez dokumentacije (npr. greškom ili dvaput unet) sme da se obriše.
async function documentationCount(patientId: unknown) {
  const byPatient = { patient: patientId };
  const counts = await Promise.all([
    Specification.countDocuments({ patientId, "items.0": { $exists: true } }),
    NurseEntry.countDocuments(byPatient),
    Diagnosis.countDocuments(byPatient),
    UsedMedicine.countDocuments(byPatient),
    UsedArticles.countDocuments(byPatient),
    UsedCombinations.countDocuments(byPatient),
    MedicalReport.countDocuments(byPatient),
    SocialNote.countDocuments(byPatient),
    SocialDocument.countDocuments(byPatient),
    CalendarEvent.countDocuments(byPatient),
    PatientMedicine.countDocuments(byPatient),
    PatientArticle.countDocuments(byPatient),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

// Ime i prezime za poređenje: ćirilica = latinica, bez razlike u kvačicama, slovima i razmacima
const nameKey = (p: { name?: string | null; lastName?: string | null }) => patientNameKey(p.name, p.lastName);

type DuplicatePlan = {
  groups: Array<{
    name: string;
    keep: { _id: string; documents: number };
    remove: string[];
    /** Duplikati koji imaju dokumentaciju — ne brišu se automatski */
    skipped: Array<{ _id: string; documents: number }>;
  }>;
  removeCount: number;
  skippedCount: number;
};

// Pacijenti sa istim imenom i prezimenom. U svakoj grupi ostaje onaj sa najviše dokumentacije
// (pa najstariji); brišu se samo duplikati BEZ dokumentacije — ništa medicinsko ni finansijsko se ne gubi.
async function planDuplicates(): Promise<DuplicatePlan> {
  const patients = await Patient.find({}, { name: 1, lastName: 1, createdAt: 1 }).sort({ createdAt: 1, _id: 1 }).lean();
  const byName = new Map<string, typeof patients>();
  for (const p of patients) {
    const key = nameKey(p);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const groups: DuplicatePlan["groups"] = [];
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    const ranked = await Promise.all(list.map(async (p, order) => ({ p, order, documents: await documentationCount(p._id) })));
    ranked.sort((a, b) => b.documents - a.documents || a.order - b.order);
    const [keep, ...rest] = ranked;
    groups.push({
      name: `${keep!.p.name} ${keep!.p.lastName}`.trim(),
      keep: { _id: String(keep!.p._id), documents: keep!.documents },
      remove: rest.filter((r) => r.documents === 0).map((r) => String(r.p._id)),
      skipped: rest.filter((r) => r.documents > 0).map((r) => ({ _id: String(r.p._id), documents: r.documents })),
    });
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, "sr"));
  return {
    groups,
    removeCount: groups.reduce((n, g) => n + g.remove.length, 0),
    skippedCount: groups.reduce((n, g) => n + g.skipped.length, 0),
  };
}

// GET /api/patient/duplicates — pregled pre brisanja (admin, glavna sestra, socijalni radnik)
const getDuplicatePatients = async (req: Request, res: Response) => {
  try {
    if (!PATIENT_EDIT_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: "Nemate dozvolu da brišete duplikate." });
    return res.json({ success: true, ...(await planDuplicates()) });
  } catch (error) {
    return res.status(statusOf(error)).json({ success: false, message: errorMessage(error) });
  }
};

// POST /api/patient/duplicates/remove — briše duplikate bez dokumentacije (plan se računa ponovo na serveru)
const removeDuplicatePatients = async (req: Request, res: Response) => {
  try {
    if (!PATIENT_EDIT_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: "Nemate dozvolu da brišete duplikate." });
    const plan = await planDuplicates();
    const ids = plan.groups.flatMap((g) => g.remove);
    if (ids.length > 0) {
      // Prazni periodi (bez stavki) i prazni socijalni profili nastaju sami i brišu se sa pacijentom
      await Specification.deleteMany({ patientId: { $in: ids } });
      await SocialProfile.deleteMany({ patient: { $in: ids } });
      await Patient.deleteMany({ _id: { $in: ids } });
      await AuditLog.create({ action: "patient.dedupe", user: req.user._id, summary: `Obrisano ${ids.length} duplikata pacijenata (bez dokumentacije)` });
    }
    const message =
      ids.length === 0 ? "Nema duplikata za brisanje." : `Obrisano duplikata: ${ids.length}.`;
    return res.json({
      success: true,
      removed: ids.length,
      skipped: plan.skippedCount,
      message: plan.skippedCount > 0 ? `${message} ${plan.skippedCount} duplikata ima dokumentaciju i nije obrisano.` : message,
    });
  } catch (error) {
    return res.status(statusOf(error)).json({ success: false, message: errorMessage(error) });
  }
};

const getPatients = async (_req: Request, res: Response) => {
    try{
        // Poslednji dodati prvi (_id kao rezerva za stare zapise bez createdAt)
        const patients = await Patient.find().populate("createdBy", "name role").sort({ createdAt: -1, _id: -1 }).lean()
        return res.status(200).json({success: true, patients})
    }catch(error){
         return res.status(500).json({success: false, error: "get patient server error"})
    }
    
}

const getPatient = async (req: Request, res: Response) => {
    try {
        
        const id = param(req, "id");
        const patient = await Patient.findById({_id : id})
        if (!patient) {
      return res
        .status(404)
        .json({ success: false, error: "Patient not found" });
    }
        return res.status(200).json({success: true, patient})
        
    } catch (error) {
         return res.status(500).json({success: false, error: "get patient server error"})
    }
}
const addPatient = async (req: Request, res: Response) => {
      try {
    if (req.user.role !== "admin" && req.user.role !== "main-nurse") {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da dodate pacijenta" });
    }

    const { name, lastName, dateOfBirth, address, admissionDate, contactPerson } = req.body;

    // Datumi se čuvaju kao kalendarski dan (UTC ponoć) — od dana prijema se
    // računa mreža 30-dnevnih perioda specifikacija.
    const admissionDay = parseCalendarDay(admissionDate);
    const birthDay = dateOfBirth ? parseCalendarDay(dateOfBirth) : null;
    if (!admissionDay || (dateOfBirth && !birthDay)) {
      return res.status(400).json({ success: false, message: "Neispravan datum rođenja ili prijema" });
    }

    if (typeof name !== "string" || !name.trim() || typeof lastName !== "string" || !lastName.trim()) {
      return res.status(400).json({ success: false, message: "Unesite ime i prezime." });
    }
    await assertUniquePatientName(name, lastName);

    const patient = await Patient.create({
      name: name.trim(),
      lastName: lastName.trim(),
      dateOfBirth: birthDay,
      address: typeof address === "string" ? address.trim() : "",
      admissionDate: admissionDay,
      contactPerson: contactPerson || "",
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, patient });
  } catch (err) {
    res.status(statusOf(err)).json({ success: false, message: errorMessage(err), error: errorMessage(err) });
  }
}
// Ispravka podataka pacijenta (pogrešno uneto ime, datum, adresa, kontakt). Šalju se
// samo polja koja se menjaju; postojeće specifikacije i periodi se ne diraju.
const updatePatient = async (req: Request, res: Response) => {
  try {
    const patient = await Patient.findById(param(req, "id"));
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen." });
    const body = req.body ?? {};
    const keyBefore = patientNameKey(patient.name, patient.lastName);

    for (const field of ["name", "lastName"] as const) {
      if (body[field] === undefined) continue;
      const value = typeof body[field] === "string" ? body[field].trim() : "";
      if (!value) return res.status(400).json({ success: false, message: "Ime i prezime ne mogu biti prazni." });
      patient[field] = value.slice(0, 200);
    }
    // Preimenovanje u ime koje već ima drugi korisnik nije dozvoljeno
    if (patientNameKey(patient.name, patient.lastName) !== keyBefore) await assertUniquePatientName(patient.name, patient.lastName, patient._id);
    if (body.address !== undefined) patient.address = typeof body.address === "string" ? body.address.trim().slice(0, 200) : "";
    if (body.contactPerson !== undefined) patient.contactPerson = typeof body.contactPerson === "string" ? body.contactPerson.trim().slice(0, 300) : "";
    if (body.dateOfBirth === null || body.dateOfBirth === "") {
      patient.set("dateOfBirth", null);
      delete body.dateOfBirth;
    }
    for (const field of ["dateOfBirth", "admissionDate"] as const) {
      if (body[field] === undefined) continue;
      const day = parseCalendarDay(body[field]);
      if (!day) return res.status(400).json({ success: false, message: field === "dateOfBirth" ? "Neispravan datum rođenja." : "Neispravan datum prijema." });
      patient[field] = day;
    }
    const birth = normalizeStoredDay(patient.dateOfBirth);
    const admission = normalizeStoredDay(patient.admissionDate);
    if (birth && admission && birth > admission) return res.status(400).json({ success: false, message: "Datum rođenja je posle datuma prijema." });

    await patient.save();
    return res.json({ success: true, message: "Podaci pacijenta su izmenjeni.", patient });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Brisanje je dozvoljeno samo za pacijenta bez ikakve dokumentacije (npr. greškom unet).
// Pacijent sa zapisima (specifikacije, unosi, izveštaji, beleške, zalihe) se otpušta — medicinska
// i finansijska dokumentacija se čuva i ne sme ostati bez pacijenta.
const deletePatient = async (req: Request, res: Response) => {
  try {
    if (!PATIENT_EDIT_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da obrišete pacijenta" });
    }
    const id = param(req, "id");
    const patient = await Patient.findById(id);
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen." });

    const byPatient = { patient: patient._id };

    // Trajno brisanje (admin i socijalni radnik): korisnik i SVI njegovi podaci. Nepovratno — potvrda je u aplikaciji,
    // a brisanje se upisuje u zapisnik (bez ličnih podataka).
    if (req.query.permanent === "true") {
      if (!PATIENT_PURGE_ROLES.includes(req.user.role)) return res.status(403).json({ success: false, message: "Trajno brisanje može samo admin ili socijalni radnik." });
      await Promise.all([
        Specification.deleteMany({ patientId: patient._id }),
        NurseEntry.deleteMany(byPatient),
        Diagnosis.deleteMany(byPatient),
        UsedMedicine.deleteMany(byPatient),
        UsedArticles.deleteMany(byPatient),
        UsedCombinations.deleteMany(byPatient),
        MedicalReport.deleteMany(byPatient),
        SocialNote.deleteMany(byPatient),
        SocialDocument.deleteMany(byPatient),
        SocialProfile.deleteMany(byPatient),
        CalendarEvent.deleteMany(byPatient),
        PatientMedicine.deleteMany(byPatient),
        PatientArticle.deleteMany(byPatient),
        MedicineReserve.deleteMany(byPatient),
        AuditLog.deleteMany(byPatient),
      ]);
      await Patient.deleteOne({ _id: patient._id });
      const initials = `${patient.name.charAt(0)}. ${patient.lastName.charAt(0)}.`;
      await AuditLog.create({ action: "patient.purge", user: req.user._id, summary: `Trajno obrisan korisnik ${initials} sa svim podacima` });
      return res.status(200).json({ success: true, message: "Korisnik i svi njegovi podaci su trajno obrisani." });
    }

    const documents = await documentationCount(patient._id);
    if (documents > 0) {
      return res.status(409).json({
        success: false,
        message: "Pacijent ima dokumentaciju (specifikacije, unose, izveštaje ili zalihe) i ne može se obrisati. Otpustite ga — podaci ostaju sačuvani.",
      });
    }

    // Prazni periodi (bez stavki) nastaju sami i brišu se sa pacijentom
    await Specification.deleteMany({ patientId: patient._id });
    await SocialProfile.deleteMany(byPatient);
    await Patient.deleteOne({ _id: patient._id });
    return res.status(200).json({ success: true, message: "Pacijent je obrisan." });
  } catch (error) {
    return res.status(statusOf(error)).json({ success: false, message: errorMessage(error) });
  }
};
const dischargePatient = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { dischargeDate } = req.body;

    const dischargeDay = parseCalendarDay(dischargeDate);
    if (!dischargeDay) {
      return res.status(400).json({ success: false, message: "Neispravan datum otpusta." });
    }

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen." });
    }

    const admissionDay = normalizeStoredDay(patient.admissionDate);
    if (admissionDay && dischargeDay < admissionDay) {
      return res.status(400).json({ success: false, message: "Datum otpusta ne može biti pre datuma prijema." });
    }

    // 🩺 Postavi datum otpusta
    patient.dischargeDate = dischargeDay;
    await patient.save();

    // 🔎 Specifikacija u koju pada dan otpusta (prednost ima aktivna). Ne
    // oslanjamo se na "danas" jer otpust može biti unet retroaktivno.
    const { $gte: dayFrom, $lt: dayTo } = sameDayQuery(dischargeDay);
    const specToClose = await Specification.findOne({
      patientId: id,
      startDate: { $lt: dayTo },
      endDate: { $gte: dayFrom },
    }).sort({ isActive: -1, startDate: -1 });

    if (specToClose && (normalizeStoredDay(specToClose.endDate) ?? specToClose.endDate) > dischargeDay) {
      // ✂️ Prekini specifikaciju na dan otpusta
      specToClose.endDate = dischargeDay;
      await specToClose.save();
    }

    // Otpušten pacijent nema aktivnu specifikaciju
    await Specification.updateMany({ patientId: id, isActive: true }, { $set: { isActive: false } });

    return res.json({
      success: true,
      message: "Pacijent uspešno otpušten. Specifikacija završena.",
    });
  } catch (err) {
    console.error("Greška pri otpustu pacijenta:", err);
    return res.status(500).json({ success: false, message: errorMessage(err) });
  }
};




export {getDuplicatePatients, removeDuplicatePatients, getPatients,addPatient, getPatient, updatePatient, deletePatient, dischargePatient}