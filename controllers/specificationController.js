import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Specification from "../models/Specification.js"
import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";

const getSpecification = async (req, res) => {
  try {
    const { patientId } = req.params;

    const spec = await getOrCreateActiveSpecification(patientId);

    if (!spec) {
      // pacijent je otpušten – NEMA aktivnih specifikacija
      return res.json({
        success: true,
        specification: null
      });
    }

    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
// ✅ DODAVANJE SMESTAJA I DODATNIH TROŠKOVA
const addCostsToSpecification = async (req, res) => {
  try {
    const { id } = req.params;
    const { lodgingPrice, extraCostAmount, extraCostLabel } = req.body;

    const spec = await Specification.findById(id);
    if (!spec) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena." });
    }

    let totalAdd = 0;

    // ✅ Cena smeštaja
    if (lodgingPrice && lodgingPrice > 0) {
      spec.items.push({
        name: "Cena smeštaja",
        category: "lodging",
        amount: 1,
        price: lodgingPrice,
        date: new Date()
      });

      totalAdd += lodgingPrice;
    }

    // ✅ Dodatni trošak
    if (extraCostAmount && extraCostAmount > 0) {
      spec.items.push({
        name: extraCostLabel || "Dodatni trošak",
        category: "extra",
        amount: 1,
        price: extraCostAmount,
        date: new Date()
      });

      totalAdd += extraCostAmount;
    }

    // ✅ Ažuriranje totalPrice
    spec.totalPrice += totalAdd;

    await spec.save();

    return res.json({ success: true, specification: spec });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 📌 VRATI istoriju + aktivnu specifikaciju
const getSpecificationHistory = async (req, res) => {
  try {
    const { patientId } = req.params;

    const specs = await Specification.find({ patientId }).sort({ startDate: 1 });

    if (!specs.length) {
      return res.json({ activeSpec: null, history: [] });
    }

    const patient = await Patient.findById(patientId);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let activeSpec = null;
    let history = [];

    if (patient.dischargeDate) {
      // 🔥 PACIJENT OTPUŠTEN → sve specifikacije su istorija
      history = specs;
    } else {
      // 🔥 PACIJENT AKTIVAN
      activeSpec = specs.find((s) => new Date(s.endDate) >= today);
      history = specs.filter((s) => new Date(s.endDate) < today);
    }
      history = history.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    return res.json({
      activeSpec: activeSpec || null,
      history,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Greška pri učitavanju istorije." });
  }
};



// Vraća pojedinačnu specifikaciju po ID
const getSpecificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const specification = await Specification.findById(id);
    if (!specification) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena." });
    }
    return res.json({ success: true, specification });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


export {getSpecification, getSpecificationHistory, getSpecificationById, addCostsToSpecification}