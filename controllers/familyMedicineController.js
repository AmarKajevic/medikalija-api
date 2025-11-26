// controllers/familyMedicineController.js
import FamilyMedicine from "../models/FamilyMedicine.js";

// helper – vidi gore
function formatFamilyMedicineDoc(doc) {
  const obj = doc.toObject();
  const u = obj.unitsPerPackage || null;

  let packages = null;
  let remainder = null;

  if (u) {
    packages = Math.floor((obj.quantity || 0) / u);
    remainder = (obj.quantity || 0) % u;
  }

  return {
    ...obj,
    unitsPerPackage: u,
    packages,
    remainder,
  };
}

// ✅ pomoćni: izračunaj ukupan broj tableta
function calculateTotalUnits({ quantity, packages, unitsPerPackage }) {
  let total = 0;

  if (packages && unitsPerPackage) {
    total += Number(packages) * Number(unitsPerPackage);
  }

  if (quantity) {
    total += Number(quantity); // dodatne “rasute” tablete
  }

  return total;
}

// ----------------------------------------
// POST /api/familyMedicine
// body: { patientId, name, quantity?, packages?, unitsPerPackage? }
// ----------------------------------------
export const addFamilyMedicine = async (req, res) => {
  try {
    const { patientId, name, quantity, packages, unitsPerPackage } = req.body;

    if (!patientId || !name) {
      return res
        .status(400)
        .json({ success: false, message: "patientId i name su obavezni." });
    }

    const total = calculateTotalUnits({ quantity, packages, unitsPerPackage });

    if (!total) {
      return res.status(400).json({
        success: false,
        message:
          "Morate uneti quantity ili packages + unitsPerPackage (ili oba).",
      });
    }

    const fm = await FamilyMedicine.create({
      patient: patientId,
      name,
      quantity: total,
      unitsPerPackage: unitsPerPackage || null,
      createdBy: req.user?._id || null,
    });

    return res
      .status(201)
      .json({ success: true, familyMedicine: formatFamilyMedicineDoc(fm) });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
};

// ----------------------------------------
// PUT /api/familyMedicine/:familyMedicineId
// body može da sadrži:
//  - quantity       → direktno setujemo ukupan broj tableta
//  - addQuantity    → dodaj još X tableta
//  - packages + unitsPerPackage → dodaj još pakovanja
// ----------------------------------------
export const updateFamilyMedicine = async (req, res) => {
  try {
    const { familyMedicineId } = req.params;
    const { quantity, addQuantity, packages, unitsPerPackage } = req.body;

    const fm = await FamilyMedicine.findById(familyMedicineId);
    if (!fm) {
      return res
        .status(404)
        .json({ success: false, message: "Lek nije pronađen." });
    }

    // 1) ako je stigao quantity → setujemo
    if (quantity !== undefined) {
      fm.quantity = Number(quantity);
    }

    // 2) ako je stigao addQuantity → dodajemo
    if (addQuantity !== undefined) {
      fm.quantity += Number(addQuantity);
    }

    // 3) ako su stigla pakovanja
    if (packages && unitsPerPackage) {
      const total = Number(packages) * Number(unitsPerPackage);

      // ako do sada nismo imali unitsPerPackage → može da se setuje
      if (!fm.unitsPerPackage) {
        fm.unitsPerPackage = Number(unitsPerPackage);
      }

      // ako postoji i različito je, ovde ili menjaš ili bacaš error – ja menjam
      if (
        fm.unitsPerPackage &&
        Number(unitsPerPackage) !== Number(fm.unitsPerPackage)
      ) {
        fm.unitsPerPackage = Number(unitsPerPackage);
      }

      fm.quantity += total;
    }

    await fm.save();

    return res
      .status(200)
      .json({ success: true, familyMedicine: formatFamilyMedicineDoc(fm) });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
};

// ----------------------------------------
// DELETE /api/familyMedicine/:familyMedicineId
// ----------------------------------------
export const deleteFamilyMedicine = async (req, res) => {
  try {
    const { familyMedicineId } = req.params;

    const deleted = await FamilyMedicine.findByIdAndDelete(familyMedicineId);
    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Lek nije pronađen." });
    }

    return res.status(200).json({
      success: true,
      message: "Lek od porodice uspešno izbrisan.",
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
};

// ----------------------------------------
// GET /api/familyMedicine/:familyMedicineId
// ----------------------------------------
export const getFamilyMedicine = async (req, res) => {
  try {
    const { familyMedicineId } = req.params;

    const fm = await FamilyMedicine.findById(familyMedicineId).populate(
      "patient",
      "name lastName"
    );

    if (!fm) {
      return res
        .status(404)
        .json({ success: false, message: "Lek nije pronađen." });
    }

    return res.status(200).json({
      success: true,
      familyMedicine: formatFamilyMedicineDoc(fm),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
};

// ----------------------------------------
// GET /api/familyMedicine
// opcioni query ?patientId=...
// ----------------------------------------
export const getFamilyMedicines = async (req, res) => {
  try {
    const { patientId } = req.query;

    const filter = patientId ? { patient: patientId } : {};

    const list = await FamilyMedicine.find(filter).populate(
      "patient",
      "name lastName"
    );

    const formatted = list.map(formatFamilyMedicineDoc);

    return res
      .status(200)
      .json({ success: true, familyMedicines: formatted });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error.message });
  }
};
