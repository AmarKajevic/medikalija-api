import Medicine from "../models/Medicine.js";
import MedicineReserve from "../models/medicineReserve.js";
import PatientMedicine from "../models/PatientMedicine.js";
import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { recalcPackages } from "../utils/stock.js";


interface ReserveSource {
  _id: Types.ObjectId;
  name: string;
  pricePerUnit?: number | null;
}

// Sabira u postojeću stavku rezerve (atomično; dva istovremena premeštanja ne prave duplikat)
async function upsertReserve(
  medicine: ReserveSource,
  amount: number,
  source: "home" | "family",
  patientId: Types.ObjectId | string | null,
  userId: Types.ObjectId
) {
  await MedicineReserve.findOneAndUpdate(
    { medicine: medicine._id, source, patient: patientId || null },
    {
      $inc: { amount },
      $setOnInsert: { name: medicine.name, pricePerUnit: medicine.pricePerUnit, createdBy: userId },
    },
    { upsert: true }
  );
}

const MAX_MOVE = 100_000;
/** Količina iz zahteva: konačan broj veći od nule (NaN, "abc", Infinity se odbijaju) */
const parseAmount = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n > 0 && n <= MAX_MOVE ? Math.round(n * 100) / 100 : null;
};

// Atomično umanjuje stanje leka doma (samo ako ima dovoljno) i preračunava pakovanja
async function takeHomeStock(medicineId: unknown, amount: number) {
  const medicine = await Medicine.findOneAndUpdate({ _id: medicineId, quantity: { $gte: amount } }, { $inc: { quantity: -amount } }, { new: true });
  if (medicine) {
    recalcPackages(medicine);
    await Medicine.updateOne({ _id: medicine._id }, { $set: { packageCount: medicine.packageCount } });
  }
  return medicine;
}

async function addHomeStock(medicineId: unknown, amount: number) {
  const medicine = await Medicine.findOneAndUpdate({ _id: medicineId }, { $inc: { quantity: amount } }, { new: true });
  if (medicine) {
    recalcPackages(medicine);
    await Medicine.updateOne({ _id: medicine._id }, { $set: { packageCount: medicine.packageCount } });
  }
  return medicine;
}

// ✅ PREMEŠTANJE U REZERVU (SABIRANJE, NE DUPLIKAT) — samo uprava
export const moveToReserve = async (req: Request, res: Response) => {
  try {
    const { medicineId, source, patientId } = req.body ?? {};
    const moveAmount = parseAmount(req.body?.amount);
    if (!medicineId || moveAmount === null || !["home", "family"].includes(source)) {
      return res.status(400).json({ success: false, message: "Izaberite lek, izvor i ispravnu količinu." });
    }

    if (source === "home") {
      const exists = await Medicine.findById(medicineId);
      if (!exists) return res.status(404).json({ success: false, message: "Lek nije pronađen." });
      const medicine = await takeHomeStock(medicineId, moveAmount);
      if (!medicine) return res.status(400).json({ success: false, message: "Nema dovoljno leka u domu." });
      await upsertReserve(medicine, moveAmount, "home", null, req.user._id);
      return res.status(200).json({ success: true });
    }

    if (!patientId) return res.status(400).json({ success: false, message: "Izaberite pacijenta." });
    const patientMedicine = await PatientMedicine.findById(medicineId).populate<{ medicine: ReserveSource | null }>("medicine");
    if (!patientMedicine || patientMedicine.patient.toString() !== String(patientId)) {
      return res.status(400).json({ success: false, message: "Neispravan pacijent." });
    }
    if (!patientMedicine.medicine) return res.status(404).json({ success: false, message: "Lek više ne postoji u šifarniku." });
    const taken = await PatientMedicine.updateOne({ _id: patientMedicine._id, quantity: { $gte: moveAmount } }, { $inc: { quantity: -moveAmount } });
    if (taken.modifiedCount === 0) return res.status(400).json({ success: false, message: "Nema dovoljno leka kod pacijenta." });
    await upsertReserve(patientMedicine.medicine, moveAmount, "family", String(patientId), req.user._id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(statusOf(error)).json({ success: false, message: errorMessage(error) });
  }
};

export const deleteReserveItem = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    await MedicineReserve.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false });
  }
};
export const returnFromReserve = async (req: Request, res: Response) => {
  try {
    const { reserveId, destination } = req.body ?? {};
    const moveAmount = parseAmount(req.body?.amount);
    if (!reserveId || moveAmount === null || !["family", "home"].includes(destination)) {
      return res.status(400).json({ success: false, message: "Izaberite stavku, odredište i ispravnu količinu." });
    }

    const reserveItem = await MedicineReserve.findById(reserveId);
    if (!reserveItem) return res.status(404).json({ success: false, message: "Stavka rezerve nije pronađena." });

    // Provere PRE umanjenja rezerve, da se količina ne izgubi
    if (destination === "family" && !reserveItem.patient) {
      return res.status(400).json({ success: false, message: "Ovaj lek je u rezervu stigao sa stanja doma — može se vratiti samo u dom." });
    }
    if (destination === "home" && !(await Medicine.exists({ _id: reserveItem.medicine }))) {
      return res.status(404).json({ success: false, message: "Lek ne postoji u domu." });
    }

    // Rezerva se umanjuje atomično, samo ako ima dovoljno (dva klika ne vraćaju dvaput)
    const taken = await MedicineReserve.updateOne({ _id: reserveItem._id, amount: { $gte: moveAmount } }, { $inc: { amount: -moveAmount } });
    if (taken.modifiedCount === 0) return res.status(400).json({ success: false, message: "Nema dovoljno u rezervi." });

    if (destination === "family") {
      await PatientMedicine.findOneAndUpdate(
        { patient: reserveItem.patient, medicine: reserveItem.medicine },
        { $inc: { quantity: moveAmount } },
        { upsert: true }
      );
    } else if (!(await addHomeStock(reserveItem.medicine, moveAmount))) {
      // Lek je obrisan u međuvremenu: količina se vraća u rezervu
      await MedicineReserve.updateOne({ _id: reserveItem._id }, { $inc: { amount: moveAmount } });
      return res.status(404).json({ success: false, message: "Lek ne postoji u domu." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};



// ✅ LISTA REZERVE
export const getReserve = async (req: Request, res: Response) => {
  try {
    const { patientId } = req.query;

    let filter = {};

    if (patientId) {
      filter = { patient: patientId };
    }

    const reserve = await MedicineReserve.find(filter).sort({ createdAt: -1 });

    return res.status(200).json({ success: true, reserve });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: errorMessage(error),
    });
  }
};

