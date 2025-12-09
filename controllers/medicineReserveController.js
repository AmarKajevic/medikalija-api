import Medicine from "../models/Medicine.js";
import MedicineReserve from "../models/medicineReserve.js";

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

// ✅ PREMEŠTANJE U REZERVU (SABIRANJE, NE DUPLIKAT)
export const moveToReserve = async (req, res) => {
  try {
    const { medicineId, amount, source } = req.body;

    const moveAmount = Number(amount);
    if (!medicineId || moveAmount <= 0 || !["home", "family"].includes(source)) {
      return res.status(400).json({ success: false });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) return res.status(404).json({ success: false });

    // ✅ SKIDANJE SA IZVORA
    if (source === "home") {
      if (medicine.quantity < moveAmount) {
        return res.status(400).json({ message: "Nema dovoljno leka u domu" });
      }
      medicine.quantity -= moveAmount;
    }

    if (source === "family") {
      if (medicine.familyQuantity < moveAmount) {
        return res.status(400).json({ message: "Nema dovoljno leka iz porodice" });
      }
      medicine.familyQuantity -= moveAmount;
    }

    recalcPackages(medicine);
    await medicine.save();

    // ✅ AKO POSTOJI U REZERVI → UVEĆAJ
    let reserveItem = await MedicineReserve.findOne({
      medicine: medicine._id,
      source,
    });

    if (reserveItem) {
      reserveItem.amount += moveAmount;
      await reserveItem.save();
    } else {
      reserveItem = await MedicineReserve.create({
        medicine: medicine._id,
        name: medicine.name,
        amount: moveAmount,
        source,
        pricePerUnit: medicine.pricePerUnit,
        createdBy: req.user._id,
      });
    }

    return res.status(200).json({
      success: true,
      reserveItem,
      medicine,
    });

  } catch (error) {
    console.error("moveToReserve error:", error);
    res.status(500).json({ success: false });
  }
};
export const deleteReserveItem = async (req, res) => {
  try {
    const { id } = req.params;
    await MedicineReserve.findByIdAndDelete(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false });
  }
};
export const returnFromReserve = async (req, res) => {
  try {
    const { reserveId, amount } = req.body;

    const backAmount = Number(amount);
    if (!reserveId || backAmount <= 0) {
      return res.status(400).json({ success: false });
    }

    const reserve = await MedicineReserve.findById(reserveId);
    if (!reserve || reserve.amount < backAmount) {
      return res.status(400).json({ success: false });
    }

    const medicine = await Medicine.findById(reserve.medicine);
    if (!medicine) return res.status(404).json({ success: false });

    // ✅ VRAĆANJE NA IZVOR
    if (reserve.source === "home") {
      medicine.quantity += backAmount;
    }

    if (reserve.source === "family") {
      medicine.familyQuantity += backAmount;
    }

    reserve.amount -= backAmount;

    if (reserve.amount === 0) {
      await reserve.deleteOne();
    } else {
      await reserve.save();
    }

    recalcPackages(medicine);
    await medicine.save();

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("returnFromReserve error:", error);
    res.status(500).json({ success: false });
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
