import Medicine from "../models/Medicine.js";
import UsedMedicine from "../models/UsedMedicine.js";
import Patient from "../models/Patient.js";
import PatientMedicine from "../models/PatientMedicine.js";

import { consumeForPatient } from "../services/specificationCharges.js";
import { createNotification } from "../services/notificationService.js";

/**
 * Helper – računa pakovanja SAMO za DOM
 */
function recalcPackages(medicine) {
  const u = medicine.unitsPerPackage || 0;

  if (u > 0) {
    medicine.packageCount = Math.floor((medicine.quantity || 0) / u);
  } else {
    medicine.packageCount = 0;
  }
}

/**
 * =====================================================
 * ADD MEDICINE
 * =====================================================
 */
const addMedicine = async (req, res) => {
  try {
    const {
      name,
      pricePerUnit,
      fromFamily,
      packages,
      unitsPerPackage,
      quantity,
      patientId,
    } = req.body;

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
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * =====================================================
 * GET ALL MEDICINES (DOMSKI LAGER)
 * =====================================================
 */
const getMedicines = async (req, res) => {
  try {
    const medicines = await Medicine.find().sort({ name: 1 });
    return res.status(200).json({ success: true, medicines });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * =====================================================
 * GET ONE MEDICINE
 * =====================================================
 */
const getMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    return res.status(200).json({ success: true, medicine });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * =====================================================
 * UPDATE MEDICINE (SAMO DOMSKI LAGER)
 * =====================================================
 */
const updateMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const {
      name,
      pricePerUnit,
      packages,
      unitsPerPackage,
      quantity,
      addQuantity,
    } = req.body;

    console.log("📦 updateMedicine - req.body:", req.body);

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
      message: error.message,
    });
  }
};

/**
 * =====================================================
 * DELETE MEDICINE
 * =====================================================
 */
const deleteMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
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
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * =====================================================
 * USE MEDICINE
 * =====================================================
 */
const useMedicine = async (req, res) => {
  try {
    const { patientId, medicineId, amount } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });

    const result = await consumeForPatient("medicine", {
      patientId,
      itemId: medicineId,
      amount,
      user: req.user,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("useMedicine error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};

/**
 * =====================================================
 * GET PATIENT MEDICINE HISTORY
 * =====================================================
 */
const getPatientMedicine = async (req, res) => {
  try {
    const { patientId } = req.params;

    const usedMedicine = await UsedMedicine.find({ patient: patientId })
      .populate("medicine", "name pricePerUnit")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    const patientStock = await PatientMedicine.find({ patient: patientId })
      .populate("medicine", "name");

    return res.status(200).json({
      success: true,
      usedMedicine,
      patientStock,
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
/**
 * =====================================================
 * GET CURRENT STOCK OF MEDICINES FOR PATIENT
 * =====================================================
 */
const getPatientStockMedicines = async (req, res) => {
  try {
    const { patientId } = req.params;

    const patientMedicines = await PatientMedicine.find({
      patient: patientId,
      quantity: { $gt: 0 },
    }).populate("medicine", "name unitsPerPackage");

    const formatted = patientMedicines.map((pm) => ({
      _id: pm.medicine._id,
      name: pm.medicine.name,
      familyQuantity: pm.quantity,
      unitsPerPackage: pm.medicine.unitsPerPackage || 0,
      familyPackageCount:
        pm.medicine.unitsPerPackage > 0
          ? Math.floor(pm.quantity / pm.medicine.unitsPerPackage)
          : 0,
    }));

    return res.status(200).json({
      success: true,
      medicines: formatted,
    });
  } catch (error) {
    console.error("getPatientStockMedicines error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
/**
 * =========================================
 * UPDATE FAMILY MEDICINE (PatientMedicine)
 * =========================================
 */
const updatePatientMedicine = async (req, res) => {
  try {
    const { id } = req.params;
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
      message: error.message,
    });
  }
};
/**
 * =========================================
 * DELETE FAMILY MEDICINE (PatientMedicine)
 * =========================================
 */
const deletePatientMedicine = async (req, res) => {
  try {
    const { id } = req.params;

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
      message: error.message,
    });
  }
};




export {
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
