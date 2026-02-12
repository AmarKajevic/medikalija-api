import Medicine from "../models/Medicine.js";
import UsedMedicine from "../models/UsedMedicine.js";
import Patient from "../models/Patient.js";
import PatientMedicine from "../models/PatientMedicine.js";

import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";
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
      pricePerUnit,
      packages,
      unitsPerPackage,
      quantity,
      addQuantity,
    } = req.body;

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    if (pricePerUnit !== undefined) {
      medicine.pricePerUnit = Number(pricePerUnit);
    }

    if (unitsPerPackage !== undefined) {
      medicine.unitsPerPackage = Number(unitsPerPackage) || 0;
    }

    const u = medicine.unitsPerPackage || 0;

    if (quantity !== undefined) {
      medicine.quantity = Number(quantity);
    }

    if (addQuantity !== undefined) {
      medicine.quantity += Number(addQuantity);
    }

    const pkgCount = Number(packages) || 0;
    if (pkgCount > 0 && u > 0) {
      medicine.quantity += pkgCount * u;
    }

    recalcPackages(medicine);
    await medicine.save();

    return res.status(200).json({ success: true, medicine });

  } catch (error) {
    console.error("updateMedicine error:", error);
    return res.status(500).json({ success: false, message: error.message });
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

    const medicine = await Medicine.findById(medicineId);
    const patient = await Patient.findById(patientId);

    if (!medicine) return res.status(404).json({ success: false, message: "Lek nije pronađen" });
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });

    const useAmount = Number(amount);
    if (!useAmount || useAmount <= 0) {
      return res.status(400).json({ success: false, message: "Neispravna količina" });
    }

    if (req.user.role === "nurse") {
      const usedRecord = await UsedMedicine.create({
        patient: patientId,
        medicine: medicineId,
        amount: useAmount,
        familyAmount: 0,
        homeAmount: 0,
        fromFamily: false,
        priceAtTheTime: medicine.pricePerUnit,
        createdBy: req.user._id,
        roleUsed: req.user.role,
      });

      return res.status(200).json({
        success: true,
        message: "Sestra je dala lek — stanje se ne menja.",
        usedRecord,
      });
    }

    let familyUsed = 0;
    let homeUsed = 0;

    const patientMedicine = await PatientMedicine.findOne({
      patient: patientId,
      medicine: medicineId,
    });

    if (patientMedicine && patientMedicine.quantity > 0) {
      if (patientMedicine.quantity >= useAmount) {
        familyUsed = useAmount;
        patientMedicine.quantity -= useAmount;
      } else {
        familyUsed = patientMedicine.quantity;
        patientMedicine.quantity = 0;
        homeUsed = useAmount - familyUsed;
      }

      await patientMedicine.save();
    } else {
      homeUsed = useAmount;
    }

    if (homeUsed > 0) {
      if (medicine.quantity < homeUsed) {
        return res.status(400).json({
          success: false,
          message: "Nedovoljno leka u domu",
        });
      }

      medicine.quantity -= homeUsed;
      recalcPackages(medicine);
      await medicine.save();
    }

    const usedRecord = await UsedMedicine.create({
      patient: patientId,
      medicine: medicineId,
      amount: useAmount,
      familyAmount: familyUsed,
      homeAmount: homeUsed,
      fromFamily: familyUsed > 0,
      priceAtTheTime: medicine.pricePerUnit,
      createdBy: req.user._id,
      roleUsed: req.user.role,
    });

    if (homeUsed === 0) {
      return res.status(200).json({
        success: true,
        message: "Iskorišćen porodični lek.",
        usedRecord,
      });
    }

    const cost = homeUsed * medicine.pricePerUnit;
    const spec = await getOrCreateActiveSpecification(patientId);

    const existingItem = spec.items.find(
      (i) => i.category === "medicine" && i.name === medicine.name
    );

    if (existingItem) {
      existingItem.amount += homeUsed;
      existingItem.price += cost;
      existingItem.date = new Date();
    } else {
      spec.items.push({
        name: medicine.name,
        category: "medicine",
        amount: homeUsed,
        price: cost,
        date: new Date(),
      });
    }

    spec.totalPrice =
      spec.items.reduce((sum, i) => sum + (i.price ?? 0), 0) +
      (spec.extraCosts ?? 0);

    await spec.save();

    return res.status(200).json({
      success: true,
      message: "Lek dodat u specifikaciju.",
      usedRecord,
    });

  } catch (error) {
    console.error("useMedicine error:", error);
    return res.status(500).json({ success: false, message: error.message });
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

export {
  addMedicine,
  useMedicine,
  getMedicines,
  getMedicine,
  getPatientMedicine,
  updateMedicine,
  deleteMedicine,
};
