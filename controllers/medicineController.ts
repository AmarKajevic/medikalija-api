import mongoose from "mongoose";
import Medicine, { isMedicineForm } from "../models/Medicine.js";
import UsedMedicine from "../models/UsedMedicine.js";
import Specification from "../models/Specification.js";
import Patient from "../models/Patient.js";
import PatientMedicine from "../models/PatientMedicine.js";

import { consumeForPatient } from "../services/specificationCharges.js";
import { createEntries } from "../services/nurseEntries.js";
import { isManagerRole } from "../middleware/requireRole.js";
import type { Request, Response } from "express";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { recalcPackages } from "../utils/stock.js";
import type { StockRef } from "../models/populated.js";


/**
 * =====================================================
 * ADD MEDICINE
 * =====================================================
 */
const addMedicine = async (req: Request, res: Response) => {
  try {
    const {
      name,
      pricePerUnit,
      fromFamily,
      packages,
      unitsPerPackage,
      quantity,
      patientId,
      form,
    } = req.body;
    if (form !== undefined && !isMedicineForm(form)) {
      return res.status(400).json({ success: false, message: "Neispravna vrsta leka." });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Naziv leka je obavezan.",
      });
    }

    let totalUnitsAdded = 0;
    const pkgCount = Number(packages) || 0;
    const unitsPerPkg = Number(unitsPerPackage) || 0;
    const looseQty = Number(quantity) || 0;

    if (pkgCount > 0 && unitsPerPkg > 0) {
      totalUnitsAdded += pkgCount * unitsPerPkg;
    }
    if (looseQty > 0) {
      totalUnitsAdded += looseQty;
    }

    if (totalUnitsAdded === 0) {
      return res.status(400).json({
        success: false,
        message: "Morate uneti bar jedno pakovanje ili količinu.",
      });
    }

    // =========================================
    // PORODIČNI LEK
    // =========================================
    if (fromFamily) {
      if (!patientId) {
        return res.status(400).json({
          success: false,
          message: "Morate poslati patientId za porodične lekove.",
        });
      }

      const medicine = await Medicine.findOne({ name });
      if (!medicine) {
        return res.status(404).json({
          success: false,
          message: "Lek mora prvo postojati u sistemu.",
        });
      }

      const patientMedicine = await PatientMedicine.findOneAndUpdate(
        { patient: patientId, medicine: medicine._id },
        { $inc: { quantity: totalUnitsAdded } },
        { new: true, upsert: true }
      );

      return res.status(200).json({
        success: true,
        message: "Porodični lek dodat pacijentu.",
        patientMedicine,
      });
    }

    // =========================================
    // DOMSKI LEK
    // =========================================
    if (pricePerUnit == null) {
      return res.status(400).json({
        success: false,
        message: "Cena je obavezna za lekove koje dodaje dom.",
      });
    }

    let medicine = await Medicine.findOne({ name });

    if (medicine) {
      if (pricePerUnit !== undefined) {
        medicine.pricePerUnit = pricePerUnit;
      }

      if (form) medicine.form = form;

      if (!medicine.unitsPerPackage && unitsPerPkg > 0) {
        medicine.unitsPerPackage = unitsPerPkg;
      }

      medicine.quantity += totalUnitsAdded;
      recalcPackages(medicine);
      await medicine.save();

      return res.status(200).json({ success: true, medicine });
    }

    const newMedicine = new Medicine({
      name,
      form: form ?? "oral",
      pricePerUnit,
      quantity: totalUnitsAdded,
      unitsPerPackage: unitsPerPkg || 0,
      createdBy: req.user._id,
    });

    recalcPackages(newMedicine);
    await newMedicine.save();

    return res.status(201).json({ success: true, medicine: newMedicine });

  } catch (error) {
    console.error("addMedicine error:", error);
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

/**
 * =====================================================
 * GET ALL MEDICINES (DOMSKI LAGER)
 * =====================================================
 */
const getMedicines = async (_req: Request, res: Response) => {
  try {
    const medicines = await Medicine.find().sort({ name: 1 }).lean();
    return res.status(200).json({ success: true, medicines });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

/**
 * =====================================================
 * GET ONE MEDICINE
 * =====================================================
 */
const getMedicine = async (req: Request, res: Response) => {
  try {
    const medicineId = param(req, "medicineId");
    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    return res.status(200).json({ success: true, medicine });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

/**
 * =====================================================
 * UPDATE MEDICINE (SAMO DOMSKI LAGER)
 * =====================================================
 */
const updateMedicine = async (req: Request, res: Response) => {
  try {
    const medicineId = param(req, "medicineId");
    const {
      name,
      pricePerUnit,
      packages,
      unitsPerPackage,
      quantity,
      addQuantity,
      form,
    } = req.body;
    if (form !== undefined && !isMedicineForm(form)) {
      return res.status(400).json({ success: false, message: "Neispravna vrsta leka." });
    }

    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    // ✅ NAME UPDATE
    if (name !== undefined) {
      const trimmedName = name.trim();

      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: "Naziv ne može biti prazan",
        });
      }

      const existing = await Medicine.findOne({
        name: trimmedName,
        _id: { $ne: medicineId },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Lek sa tim nazivom već postoji",
        });
      }

      medicine.name = trimmedName;
    }

    if (form !== undefined) medicine.form = form;

    // ✅ PRICE
    if (pricePerUnit !== undefined) {
      const p = Number(pricePerUnit);
      if (!Number.isNaN(p)) {
        medicine.pricePerUnit = p;
      }
    }

    // ✅ UNITS
    if (unitsPerPackage !== undefined) {
      const u = Number(unitsPerPackage);
      if (!Number.isNaN(u)) {
        medicine.unitsPerPackage = u;
      }
    }

    // ✅ SET QUANTITY
    if (quantity !== undefined) {
      const q = Number(quantity);
      if (!Number.isNaN(q)) {
        medicine.quantity = q;
      }
    }

    // ✅ ADD QUANTITY
    if (addQuantity !== undefined) {
      const add = Number(addQuantity);
      if (!Number.isNaN(add) && add > 0) {
        medicine.quantity += add;
      }
    }

    // ✅ PACKAGES → quantity
    const pkgCount = Number(packages) || 0;
    const u = medicine.unitsPerPackage || 0;

    if (pkgCount > 0 && u > 0) {
      medicine.quantity += pkgCount * u;
    }

    recalcPackages(medicine);

    await medicine.save();

    return res.status(200).json({
      success: true,
      medicine,
    });

  } catch (error) {
    console.error("❌ updateMedicine error:", error);
    return res.status(500).json({
      success: false,
      message: errorMessage(error),
    });
  }
};

/**
 * =====================================================
 * DELETE MEDICINE
 * =====================================================
 */
const deleteMedicine = async (req: Request, res: Response) => {
  try {
    const medicineId = param(req, "medicineId");
    const medicineDelete = await Medicine.findByIdAndDelete(medicineId);

    if (!medicineDelete) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Lek uspešno izbrisan",
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

/**
 * =====================================================
 * USE MEDICINE
 * =====================================================
 */
const useMedicine = async (req: Request, res: Response) => {
  try {
    const { patientId, medicineId, amount } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });

    // Sestre: unos ide upravi na odobrenje (services/nurseEntries.ts)
    if (!isManagerRole(req.user.role)) {
      const { entries } = await createEntries(patientId, [{ type: "medicine", itemId: medicineId, amount }], req.user);
      return res.status(200).json({ success: true, message: "Poslato upravi na odobrenje.", entries, specification: null, familyUsed: 0, homeUsed: 0 });
    }

    const result = await consumeForPatient("medicine", {
      patientId,
      itemId: medicineId,
      amount,
      user: req.user,
      specificationId: req.body.specificationId,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("useMedicine error:", error);
    return res.status(statusOf(error)).json({ success: false, message: errorMessage(error) });
  }
};

/**
 * =====================================================
 * GET PATIENT MEDICINE HISTORY
 * =====================================================
 */
const getPatientMedicine = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");

    // Dva nezavisna čitanja idu paralelno; lean = obični objekti (samo za prikaz)
    const [usedMedicine, patientStock] = await Promise.all([
      UsedMedicine.find({ patient: patientId })
        .populate("medicine", "name pricePerUnit")
        .populate("createdBy", "name role")
        .sort({ createdAt: -1 })
        .lean(),
      PatientMedicine.find({ patient: patientId }).populate("medicine", "name").lean(),
    ]);

    return res.status(200).json({
      success: true,
      usedMedicine,
      patientStock,
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};
/**
 * =====================================================
 * GET CURRENT STOCK OF MEDICINES FOR PATIENT
 * =====================================================
 */
const getPatientStockMedicines = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");

    const patientMedicines = await PatientMedicine.find({
      patient: patientId,
      quantity: { $gt: 0 },
    }).populate<{ medicine: StockRef | null }>("medicine", "name unitsPerPackage");

    // Lek je mogao biti obrisan iz šifarnika — takvi zapisi se preskaču (ranije 500)
    const formatted = patientMedicines.flatMap(({ medicine, quantity }) => {
      if (!medicine) return [];
      const units = medicine.unitsPerPackage || 0;
      return [{
        _id: medicine._id,
        name: medicine.name,
        familyQuantity: quantity,
        unitsPerPackage: units,
        familyPackageCount: units > 0 ? Math.floor(quantity / units) : 0,
      }];
    });

    return res.status(200).json({
      success: true,
      medicines: formatted,
    });
  } catch (error) {
    console.error("getPatientStockMedicines error:", error);
    return res.status(500).json({
      success: false,
      message: errorMessage(error),
    });
  }
};
/**
 * =========================================
 * UPDATE FAMILY MEDICINE (PatientMedicine)
 * =========================================
 */
const updatePatientMedicine = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { quantity, addQuantity } = req.body;

    const patientMedicine = await PatientMedicine.findById(id);

    if (!patientMedicine) {
      return res.status(404).json({
        success: false,
        message: "Porodični lek nije pronađen",
      });
    }

    if (quantity !== undefined) {
      patientMedicine.quantity = Number(quantity);
    }

    if (addQuantity !== undefined) {
      patientMedicine.quantity += Number(addQuantity);
    }

    await patientMedicine.save();

    return res.status(200).json({
      success: true,
      patientMedicine,
    });

  } catch (error) {
    console.error("updatePatientMedicine error:", error);
    return res.status(500).json({
      success: false,
      message: errorMessage(error),
    });
  }
};
/**
 * =========================================
 * DELETE FAMILY MEDICINE (PatientMedicine)
 * =========================================
 */
const deletePatientMedicine = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");

    const patientMedicine = await PatientMedicine.findById(id);

    if (!patientMedicine) {
      return res.status(404).json({
        success: false,
        message: "Porodični lek nije pronađen",
      });
    }

    await PatientMedicine.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Porodični lek uspešno obrisan",
    });

  } catch (error) {
    console.error("deletePatientMedicine error:", error);
    return res.status(500).json({
      success: false,
      message: errorMessage(error),
    });
  }
};




/**
 * Razvrstavanje lekova: tablete/kapsule ili ampule/rastvori/sol, za više lekova odjednom.
 * Ispravlja se i vrsta na stavkama tih lekova koje su već u specifikacijama (sve su
 * dobile "tablete" samo zato što je to bilo podrazumevano), pa se grupe tamo poklapaju.
 */
const setMedicinesForm = async (req: Request, res: Response) => {
  try {
    const { ids, form } = req.body ?? {};
    if (!isMedicineForm(form)) return res.status(400).json({ success: false, message: "Neispravna vrsta leka." });
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: "Izaberite lekove." });
    if (ids.length > 2000 || !ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "Neispravan izbor lekova." });
    }
    const objectIds = ids.map((id: string) => new mongoose.Types.ObjectId(id));
    const updated = await Medicine.updateMany({ _id: { $in: objectIds } }, { $set: { form } });
    await Specification.updateMany(
      { "items.medicine": { $in: objectIds } },
      { $set: { "items.$[it].form": form } },
      { arrayFilters: [{ "it.medicine": { $in: objectIds } }] }
    );
    return res.json({ success: true, message: `Prebačeno: ${updated.modifiedCount}.`, modified: updated.modifiedCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

export {
  setMedicinesForm,
  addMedicine,
  useMedicine,
  getMedicines,
  getMedicine,
  getPatientMedicine,
  updateMedicine,
  deleteMedicine,
  getPatientStockMedicines,
  updatePatientMedicine,
  deletePatientMedicine
};
