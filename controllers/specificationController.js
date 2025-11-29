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
    const { extraCostAmount, extraCostLabel } = req.body;

    const spec = await Specification.findById(id);
    if (!spec) {
      return res
        .status(404)
        .json({ success: false, message: "Specifikacija nije pronađena." });
    }

    let totalAdd = 0;

    if (extraCostAmount && extraCostAmount > 0) {
      spec.items.push({
        name: extraCostLabel || "Dodatni trošak",
        category: "extra",
        amount: 1,
        price: extraCostAmount,
        date: new Date(),
      });

      totalAdd += extraCostAmount;
      spec.extraCosts = (spec.extraCosts || 0) + extraCostAmount;
    }

    spec.totalPrice += totalAdd;

    await spec.save();

    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: err.message });
  }
};
// controllers/specificationController.js (nastavak)

// ✅ SAČUVAJ KOMPLETAN OBRAČUN (specifikacija + dug + smeštaj za naredni period)
const saveBillingForSpecification = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      previousDebtEUR,   // dug u evrima
      nextLodgingEUR,    // smeštaj za naredni period u evrima
      lowerExchangeRate, // niži kurs
      middleExchangeRate // srednji kurs
    } = req.body;

    const spec = await Specification.findById(id);
    if (!spec) {
      return res
        .status(404)
        .json({ success: false, message: "Specifikacija nije pronađena." });
    }

    const specTotalRSD = spec.totalPrice ?? 0;

    const low = Number(lowerExchangeRate) || 0;
    const mid = Number(middleExchangeRate) || 0;
    const debtEUR = Number(previousDebtEUR) || 0;
    const lodgingEUR = Number(nextLodgingEUR) || 0;

    // ✅ SPECIFIKACIJA po NIŽEM kursu
    const specEUR = low > 0 ? specTotalRSD / low : 0;

    // ✅ DUG po NIŽEM kursu (tvoja izmena)
    const debtRSD = low > 0 ? debtEUR * low : 0;

    // ✅ SMEŠTAJ za naredni period po SREDNJEM kursu
    const lodgingRSD = mid > 0 ? lodgingEUR * mid : 0;

    const totalRSD = specTotalRSD + debtRSD + lodgingRSD;
    const totalEUR = specEUR + debtEUR + lodgingEUR;

    // izračunaj period smeštaja za naredni mesec (30 dana)
    const currentEndDate = new Date(spec.endDate);
    const nextStartDate = new Date(currentEndDate);
    nextStartDate.setDate(nextStartDate.getDate() + 1);
    const nextEndDate = new Date(nextStartDate);
    nextEndDate.setDate(nextEndDate.getDate() + 29);

    spec.billing = {
      lowerExchangeRate: low,
      middleExchangeRate: mid,
      previousDebtEUR: debtEUR,
      previousDebtRSD: debtRSD,
      nextLodgingEUR: lodgingEUR,
      nextLodgingRSD: lodgingRSD,
      specEUR,
      totalRSD,
      totalEUR,
      nextPeriodStart: nextStartDate,
      nextPeriodEnd: nextEndDate,
    };

    await spec.save();

    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, message: err.message });
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


export {getSpecification, getSpecificationHistory, getSpecificationById, addCostsToSpecification, saveBillingForSpecification}