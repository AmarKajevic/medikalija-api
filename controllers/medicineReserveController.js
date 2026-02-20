import Medicine from "../models/Medicine.js";
import MedicineReserve from "../models/medicineReserve.js";
import PatientMedicine from "../models/PatientMedicine.js";


async function upsertReserve(medicine, amount, source, patientId, userId) {
  let reserveItem = await MedicineReserve.findOne({
    medicine: medicine._id,
    source,
    patient: patientId || null,
  });

  if (reserveItem) {
    reserveItem.amount += amount;
    await reserveItem.save();
  } else {
    await MedicineReserve.create({
      medicine: medicine._id,
      patient: patientId || null,
      name: medicine.name,
      amount,
      source,
      pricePerUnit: medicine.pricePerUnit,
      createdBy: userId,
    });
  }
}


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
    const { medicineId, amount, source, patientId } = req.body;

    const moveAmount = Number(amount);

    if (!medicineId || moveAmount <= 0 || !["home", "family"].includes(source)) {
      return res.status(400).json({ success: false });
    }

    // ================= HOME =================
    if (source === "home") {
      const medicine = await Medicine.findById(medicineId);
      if (!medicine) return res.status(404).json({ success: false });

      if (medicine.quantity < moveAmount) {
        return res.status(400).json({ message: "Nema dovoljno leka u domu" });
      }

      medicine.quantity -= moveAmount;
      recalcPackages(medicine);
      await medicine.save();

      await upsertReserve(medicine, moveAmount, "home", null, req.user._id);

      return res.status(200).json({ success: true });
    }

    // ================= FAMILY =================
    if (source === "family") {
      if (!patientId) {
        return res.status(400).json({ message: "PatientId je obavezan" });
      }
      const patientMedicine = await PatientMedicine.findById(medicineId).populate("medicine");

      if (!patientMedicine || patientMedicine.patient.toString() !== patientId) {
        return res.status(400).json({ message: "Neispravan pacijent" });
      }


      if (!patientMedicine || patientMedicine.quantity < moveAmount) {
        return res.status(400).json({ message: "Nema dovoljno leka kod pacijenta" });
      }

      patientMedicine.quantity -= moveAmount;
      await patientMedicine.save();

      await upsertReserve(
        patientMedicine.medicine,
        moveAmount,
        "family",
        patientId,
        req.user._id
      );

      return res.status(200).json({ success: true });
    }

  } catch (error) {
    console.error(error);
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
      const patientMedicine = await PatientMedicine.findOne({
        patient: reserve.patient,
        medicine: reserve.medicine,
      });

      if (patientMedicine) {
        patientMedicine.quantity += backAmount;
        await patientMedicine.save();
      }
    }

    // 🔥 OVO FALI
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
      message: error.message,
    });
  }
};

