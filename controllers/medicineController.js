// controllers/medicineController.js
import Medicine from "../models/Medicine.js";
import UsedMedicine from "../models/UsedMedicine.js";
import Patient from "../models/Patient.js";

import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";
import { createNotification } from "../services/notificationService.js";

/**
 * Helper – nakon svake izmene količine,
 * izračunamo broj punih pakovanja.
 */
function recalcPackages(medicine) {
  const u = medicine.unitsPerPackage || 0;

  if (u > 0) {
    medicine.packageCount = Math.floor((medicine.quantity || 0) / u);
    medicine.familyPackageCount = Math.floor(
      (medicine.familyQuantity || 0) / u
    );
  } else {
    medicine.packageCount = 0;
    medicine.familyPackageCount = 0;
  }
}

/**
 * POST /api/medicine/add
 *  body: {
 *    name,
 *    pricePerUnit,
 *    fromFamily?: boolean,
 *    packages?: number,
 *    unitsPerPackage?: number,
 *    quantity?: number   // dodatni komadi, van pakovanja (opciono)
 *  }
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
    } = req.body;

    // Naziv uvek mora da postoji
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Naziv leka je obavezan.",
      });
    }

    // Cena je obavezna SAMO ako lek dodaje DOM (NE porodica)
    if (!fromFamily && pricePerUnit == null) {
      return res.status(400).json({
        success: false,
        message: "Cena je obavezna za lekove koje dodaje dom.",
      });
    }

    // koliko komada unosimo ukupno?
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
        message:
          "Morate uneti bar jedno pakovanje ili broj komada (quantity).",
      });
    }

    let medicine = await Medicine.findOne({
      name,
      createdBy: req.user._id,
    });

    if (medicine) {
      // već postoji → apdejt
      if (pricePerUnit !== undefined) {
        medicine.pricePerUnit = pricePerUnit;
      }

      // ako unitsPerPackage nije bilo setovano – setujemo
      if (!medicine.unitsPerPackage && unitsPerPkg > 0) {
        medicine.unitsPerPackage = unitsPerPkg;
      }

      if (fromFamily) {
        medicine.familyQuantity += totalUnitsAdded;
      } else {
        medicine.quantity += totalUnitsAdded;
      }

      recalcPackages(medicine);
      await medicine.save();

      return res.status(200).json({ success: true, medicine });
    }

    // novi lek
    const baseUnitsPerPackage = unitsPerPkg > 0 ? unitsPerPkg : 0;

    const homeQty = fromFamily ? 0 : totalUnitsAdded;
    const familyQty = fromFamily ? totalUnitsAdded : 0;

    const newMedicine = new Medicine({
      name,
      pricePerUnit,
      quantity: homeQty,
      familyQuantity: familyQty,
      unitsPerPackage: baseUnitsPerPackage,
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
 * GET /api/medicine
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
 * GET /api/medicine/:medicineId
 */
const getMedicine = async (req, res) => {
  const { medicineId } = req.params;
  try {
    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res
        .status(404)
        .json({ success: false, message: "Lek nije pronađen" });
    }
    return res.status(200).json({ success: true, medicine });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/medicine/:medicineId
 *  body: {
 *    pricePerUnit?,
 *    fromFamily?: boolean,
 *    // dodavanje:
 *    packages?: number,
 *    unitsPerPackage?: number,
 *    addQuantity?: number,   // dodatni komadi
 *    // ili direktno setovanje:
 *    quantity?: number
 *  }
 */
const updateMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const {
      pricePerUnit,
      fromFamily,
      packages,
      unitsPerPackage,
      quantity,
      addQuantity,
    } = req.body;

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res
        .status(404)
        .json({ success: false, message: "Lek nije pronađen" });
    }

    // 1) cena
    if (pricePerUnit !== undefined) {
      medicine.pricePerUnit = Number(pricePerUnit);
    }

    // 2) podešavanje unitsPerPackage
    if (unitsPerPackage !== undefined) {
      medicine.unitsPerPackage = Number(unitsPerPackage) || 0;
    }

    const u = medicine.unitsPerPackage || Number(unitsPerPackage) || 0;

    // 3) direktno setovanje količine (u komadima)
    if (quantity !== undefined) {
      if (fromFamily) {
        medicine.familyQuantity = Number(quantity);
      } else {
        medicine.quantity = Number(quantity);
      }
    }

    // 4) dodavanje dodatnih komada
    if (addQuantity !== undefined) {
      if (fromFamily) {
        medicine.familyQuantity += Number(addQuantity);
      } else {
        medicine.quantity += Number(addQuantity);
      }
    }

    // 5) dodavanje pakovanja
    const pkgCount = Number(packages) || 0;
    if (pkgCount > 0 && u > 0) {
      const unitsToAdd = pkgCount * u;
      if (fromFamily) {
        medicine.familyQuantity += unitsToAdd;
      } else {
        medicine.quantity += unitsToAdd;
      }
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
 * DELETE /api/medicine/:medicineId
 */
const deleteMedicine = async (req, res) => {
  const { medicineId } = req.params;
  try {
    const medicineDelete = await Medicine.findByIdAndDelete(medicineId);
    if (medicineDelete) {
      return res
        .status(200)
        .json({ success: true, message: "Lek uspešno izbrisan" });
    }
    return res
      .status(404)
      .json({ success: false, message: "Lek nije pronađen" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/medicine/use
 *  body: { patientId, medicineId, amount }
 * - skida se sa familyQuantity → Medikalija quantity
 * - ažurira se packageCount / familyPackageCount
 * - eventualno ulazi u specifikaciju (osim ako je nurse)
 */
const useMedicine = async (req, res) => {
  try {
    const { patientId, medicineId, amount } = req.body;

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Pacijent nije pronađen",
      });
    }

    const useAmount = Number(amount);
    if (!useAmount || useAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Neispravna količina" });
    }

    // =====================================================================
    // 🔵 1) SESTRA — NE SME DA MENJA ZALIHE I NE ULAZI U SPECIFIKACIJU
    // =====================================================================
    if (req.user.role === "nurse") {
      console.log("➡️ Sestra koristi lek — NE diram stanje!");

      const usedRecord = await UsedMedicine.create({
        patient: patientId,
        medicine: medicineId,
        amount: useAmount,
        fromFamily: false,
        familyAmount: 0,
        homeAmount: 0,
        priceAtTheTime: medicine.pricePerUnit,
        createdBy: req.user._id,
        roleUsed: req.user.role,
      });

      await createNotification(
        patient.createdBy,
        "medicine",
        `${req.user.name} ${req.user.lastName} je dala lek pacijentu ${patient.name} ${patient.lastName}.`
      );

      return res.status(200).json({
        success: true,
        message: "Sestra je dala lek — stanje se NE umanjuje i NE ulazi u specifikaciju.",
        usedRecord,
      });
    }

    // =====================================================================
    // 🔴 2) ADMIN / VLASNIK — NORMALNO SKIDA SA ZALIHA I ULAZI U SPECIFIKACIJU
    // =====================================================================
    let familyUsed = 0;
    let homeUsed = 0;

    if (medicine.familyQuantity >= useAmount) {
      familyUsed = useAmount;
      medicine.familyQuantity -= useAmount;
    } else {
      familyUsed = medicine.familyQuantity;
      medicine.familyQuantity = 0;

      homeUsed = useAmount - familyUsed;

      if (medicine.quantity < homeUsed) {
        return res.status(400).json({
          success: false,
          message: "Nedovoljno leka u domu",
        });
      }

      medicine.quantity -= homeUsed;
    }

    recalcPackages(medicine);
    await medicine.save();

    const usedRecord = await UsedMedicine.create({
      patient: patientId,
      medicine: medicineId,
      amount: useAmount,
      fromFamily: familyUsed > 0,
      familyAmount: familyUsed,
      homeAmount: homeUsed,
      priceAtTheTime: medicine.pricePerUnit,
      createdBy: req.user._id,
      roleUsed: req.user.role,
    });

    // Ako se sve skinulo iz porodične količine → NE ULAZI u specifikaciju
    if (homeUsed === 0) {
      return res.status(200).json({
        success: true,
        message: "Porodična količina iskorišćena.",
        usedRecord,
      });
    }

    // =====================================================================
    // 🔥 SPOJILI SMO STAVKE ZA ISTI LEK U SPECIFIKACIJI
    // =====================================================================
    const cost = homeUsed * medicine.pricePerUnit;
    const spec = await getOrCreateActiveSpecification(patientId);

    // Da li već postoji ovaj lek u specifikaciji?
    const existingItem = spec.items.find(
      (i) => i.category === "medicine" && i.name === medicine.name
    );

    if (existingItem) {
      existingItem.amount += homeUsed;           // povećaj količinu
      existingItem.price += cost;                // dodaj cenu
      existingItem.date = new Date();
    } else {
      // napravi novi red
      spec.items.push({
        name: medicine.name,
        category: "medicine",
        amount: homeUsed,
        price: cost,
        date: new Date(),
      });
    }

    // =====================================================================
    // 🔥 NOVI TOTAL PRICE
    // =====================================================================
    spec.totalPrice =
      spec.items.reduce((sum, i) => sum + (i.price ?? 0), 0) +
      (spec.extraCosts ?? 0);

    await spec.save();

    return res.status(200).json({
      success: true,
      message: "Lek dodat u specifikaciju (spojeni redovi).",
      usedRecord,
    });

  } catch (error) {
    console.error("useMedicine error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


/**
 * GET /api/medicine/patient/:patientId
 */
const getPatientMedicine = async (req, res) => {
  try {
    const { patientId } = req.params;

    const usedMedicine = await UsedMedicine.find({
      patient: patientId,
    })
      .populate("medicine", "name pricePerUnit")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, usedMedicine });
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
