import Medicine from "../models/Medicine.js";
import MedicineReserve from "../models/medicineReserve.js";

// helper iz tvog sistema
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

// ✅ PREMEŠTANJE U REZERVU
export const moveToReserve = async (req, res) => {
  try {
    const { medicineId, amount, source } = req.body;

    if (!medicineId || !amount || !source) {
      return res.status(400).json({
        success: false,
        message: "medicineId, amount i source su obavezni",
      });
    }

    const moveAmount = Number(amount);
    if (moveAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Količina mora biti veća od nule",
      });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({
        success: false,
        message: "Lek nije pronađen",
      });
    }

    // ✅ SKIDANJE SA IZVORA
    if (source === "home") {
      if (medicine.quantity < moveAmount) {
        return res.status(400).json({
          success: false,
          message: "Nema dovoljno leka na stanju u domu",
        });
      }
      medicine.quantity -= moveAmount;
    }

    if (source === "family") {
      if (medicine.familyQuantity < moveAmount) {
        return res.status(400).json({
          success: false,
          message: "Nema dovoljno leka iz porodice",
        });
      }
      medicine.familyQuantity -= moveAmount;
    }

    recalcPackages(medicine);
    await medicine.save();

    // ✅ UPIS U REZERVU
    const reserveItem = await MedicineReserve.create({
      medicine: medicine._id,
      name: medicine.name,
      amount: moveAmount,
      source,
      pricePerUnit: medicine.pricePerUnit,
      createdBy: req.user._id,
    });

    return res.status(200).json({
      success: true,
      reserveItem,
      medicine,
    });
  } catch (error) {
    console.error("moveToReserve error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ✅ LISTA REZERVE
export const getReserve = async (req, res) => {
  try {
    const reserve = await MedicineReserve.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, reserve });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
