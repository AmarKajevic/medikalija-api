import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Specification from "../models/Specification.js"
import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";
import GlobalSetting from "../models/GlobalSetting.js";

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


const saveBillingForSpecification = async (req, res) => {
  try {
    const { id } = req.params;
    const { previousDebtEUR, nextLodgingEUR } = req.body; // backend više ne očekuje kurseve

    const spec = await Specification.findById(id);
    if (!spec) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena" });
    }

    // Dohvati globalne kurseve
    const globalSettings = await GlobalSettingjokp.findOne();
    const low = globalSettings?.lowerExchangeRate || 0;
    const mid = globalSettings?.middleExchangeRate || 0;

    const debtEUR = Number(previousDebtEUR) || 0;
    const lodgingEUR = Number(nextLodgingEUR) || 0;
    const specTotalRSD = spec.totalPrice ?? 0;

    const specEUR = low > 0 ? specTotalRSD / low : 0;
    const debtRSD = mid > 0 ? debtEUR * mid : 0;
    const lodgingRSD = mid > 0 ? lodgingEUR * mid : 0;
    const totalRSD = specTotalRSD + debtRSD + lodgingRSD;
    const totalEUR = specEUR + debtEUR + lodgingEUR;

    // Računanje narednog perioda (30 dana od kraja specifikacije)
    const currentEndDate = new Date(spec.endDate);
    const nextPeriodStart = new Date(currentEndDate);
    nextPeriodStart.setDate(nextPeriodStart.getDate() + 1);
    const nextPeriodEnd = new Date(nextPeriodStart);
    nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 29);

    spec.billing = {
      previousDebtEUR: debtEUR,
      nextLodgingEUR: lodgingEUR,
      specEUR,
      totalRSD,
      totalEUR,
      nextPeriodStart,
      nextPeriodEnd,
    };
    await spec.save();

    res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("saveBillingForSpecification error:", err);
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
// ✅ BRISANJE STAVKE IZ SPECIFIKACIJE
const deleteSpecificationItem = async (req, res) => {
  try {
    const { specId, itemId } = req.params;

    const spec = await Specification.findById(specId);
    if (!spec) {
      return res.status(404).json({
        success: false,
        message: "Specifikacija nije pronađena",
      });
    }

    const itemIndex = spec.items.findIndex(
      (i) => i._id.toString() === itemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Stavka nije pronađena",
      });
    }

    const removedItem = spec.items[itemIndex];

    // ✅ smanji totalPrice
    spec.totalPrice = Math.max(
      0,
      (spec.totalPrice || 0) - (removedItem.price || 0)
    );

    // ✅ ukloni stavku
    spec.items.splice(itemIndex, 1);

    await spec.save();

    return res.json({
      success: true,
      message: "Stavka obrisana",
      specification: spec,
    });
  } catch (err) {
    console.error("deleteSpecificationItem:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
const calculatePreview = (req, res) => {
  const {
    specTotalRSD,
    previousDebtEUR,
    nextLodgingEUR,
    lowerExchangeRate,
    middleExchangeRate
  } = req.body;

  const low = Number(lowerExchangeRate) || 0;
  const mid = Number(middleExchangeRate) || 0;
  const debtEUR = Number(previousDebtEUR) || 0;
  const lodgingEUR = Number(nextLodgingEUR) || 0;

  const specEUR = low > 0 ? specTotalRSD / low : 0;
  const debtRSD = mid > 0 ? debtEUR * mid : 0;
  const lodgingRSD = mid > 0 ? lodgingEUR * mid : 0;

  const totalRSD = specTotalRSD + debtRSD + lodgingRSD;
  const totalEUR = specEUR + debtEUR + lodgingEUR;

  return res.json({
    specEUR,
    debtRSD,
    lodgingRSD,
    totalRSD,
    totalEUR
  });
};



export {getSpecification, getSpecificationHistory, getSpecificationById, addCostsToSpecification, saveBillingForSpecification, deleteSpecificationItem, calculatePreview}