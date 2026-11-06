import Patient from "../models/Patient.js"
import Specification from "../models/Specification.js";
import { normalizeStoredDay, parseCalendarDay, sameDayQuery } from "../utils/dateUtils.js";
import type { Request, Response } from "express";
import { errorMessage } from "../utils/errors.js";
import { param } from "../utils/http.js";

const getPatients = async (_req: Request, res: Response) => {
    try{
        const patients = await Patient.find().populate("createdBy", "name role").sort({createdAt: -1 })
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
    const birthDay = parseCalendarDay(dateOfBirth);
    if (!admissionDay || !birthDay) {
      return res.status(400).json({ success: false, message: "Neispravan datum rođenja ili prijema" });
    }

    const patient = await Patient.create({
      name,
      lastName,
      dateOfBirth: birthDay,
      address,
      admissionDate: admissionDay,
      contactPerson: contactPerson || "",
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, patient });
  } catch (err) {
    res.status(500).json({ success: false, error: errorMessage(err) });
  }
}
const deletePatient = async (req: Request, res: Response) => {
    try {
        if (req.user.role !== "admin" && req.user.role !== "main-nurse") {
  return res.status(403).json({ success: false, message: "Nemate dozvolu da obrišete pacijenta" });
        }

    const id = param(req, "id");
    const deletePatient = await Patient.findByIdAndDelete({_id: id})
    if(deletePatient) {
        return res.status(200).json({success:true, message:"pacijent je uspesno izbrisan"})
    }
    
    }catch(error){
        res.status(500).json({success: false, error: errorMessage(error)});
    }
}
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




export {getPatients,addPatient, getPatient, deletePatient, dischargePatient}