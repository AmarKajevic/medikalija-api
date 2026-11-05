import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Specification from "../models/Specification.js"
import {
  getActiveSpecification,
  activateSpecificationPeriod,
  activateExistingSpecification,
  activateNextSpecificationPeriod,
  buildSpecificationSchedule,
  futureScheduleHorizon,
} from "../services/getOrCreateActiveSpecification.js";
import GlobalSetting from "../models/GlobalSetting.js";
import { nextPeriodAfter, normalizeStoredDay } from "../utils/dateUtils.js";

const getSpecification = async (req, res) => {
  try {
    const { patientId } = req.params;

    const spec = await getActiveSpecification(patientId);

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

// ✅ RUČNO AKTIVIRANJE PERIODA (nadoknada propuštenog perioda ili ručni izbor)
const activatePeriod = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { startDate, endDate } = req.body;

    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate period specifikacije" });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: "Nedostaje opseg datuma" });
    }

    const spec = await activateSpecificationPeriod(patientId, startDate, endDate);
    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("activatePeriod error:", err);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ✅ AKTIVIRANJE SLEDEĆEG PERIODA (nadovezuje se na trenutno aktivan, računa server)
const activateNextPeriod = async (req, res) => {
  try {
    const { patientId } = req.params;

    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate period specifikacije" });
    }

    const spec = await activateNextSpecificationPeriod(patientId);
    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("activateNextPeriod error:", err);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ✅ REAKTIVIRANJE POSTOJEĆEG PERIODA IZ ISTORIJE (po ID-u, bez nagađanja datuma)
const activateExisting = async (req, res) => {
  try {
    const { patientId, specId } = req.params;

    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate period specifikacije" });
    }

    const spec = await activateExistingSpecification(patientId, specId);
    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("activateExisting error:", err);
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};
// ✅ DODAVANJE SMESTAJA I DODATNIH TROŠKOVA
const addCostsToSpecification = async (req, res) => {
  try {
    const { id } = req.params;
    const { extraCostAmount, extraCostLabel } = req.body;
    const amount = Number(extraCostAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Neispravan iznos troška." });
    }

    const spec = await Specification.findById(id);
    if (!spec) {
      return res
        .status(404)
        .json({ success: false, message: "Specifikacija nije pronađena." });
    }

    spec.items.push({
      name: extraCostLabel || "Dodatni trošak",
      category: "extra",
      amount: 1,
      price: amount,
      date: new Date(),
    });

    spec.extraCosts = (spec.extraCosts || 0) + amount;
    spec.totalPrice = (spec.totalPrice || 0) + amount;

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
    const globalSettings = await GlobalSetting.findOne();
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

    // Naredni period: dan posle kraja specifikacije + 30 kalendarskih dana
    const { startDate: nextPeriodStart, endDate: nextPeriodEnd } =
      nextPeriodAfter(normalizeStoredDay(spec.endDate));

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

    // Aktivan period je onaj eksplicitno markiran isActive:true (osim ako je
    // pacijent otpušten — tada su sve specifikacije istorija).
    let activeSpec = patient?.dischargeDate ? null : specs.find((s) => s.isActive) || null;
    let history = specs.filter((s) => !activeSpec || s._id.toString() !== activeSpec._id.toString());

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

  const specRSD = Number(specTotalRSD) || 0;
  const low = Number(lowerExchangeRate) || 0;
  const mid = Number(middleExchangeRate) || 0;
  const debtEUR = Number(previousDebtEUR) || 0;
  const lodgingEUR = Number(nextLodgingEUR) || 0;

  const specEUR = low > 0 ? specRSD / low : 0;
  const debtRSD = mid > 0 ? debtEUR * mid : 0;
  const lodgingRSD = mid > 0 ? lodgingEUR * mid : 0;

  const totalRSD = specRSD + debtRSD + lodgingRSD;
  const totalEUR = specEUR + debtEUR + lodgingEUR;

  return res.json({
    specEUR,
    debtRSD,
    lodgingRSD,
    totalRSD,
    totalEUR
  });
};



// 📅 RASPORED 30-DNEVNIH PERIODA (od prijema do 10 godina unapred)
const getFutureSpecificationPeriods = async (req, res) => {
  try {
    const { patientId } = req.params;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });
    }

    const until = futureScheduleHorizon(patient.admissionDate);
    const periods = buildSpecificationSchedule(patient.admissionDate, until);

    return res.status(200).json({
      success: true,
      patient: {
        id: patient._id,
        name: patient.name,
        lastName: patient.lastName,
        admissionDate: normalizeStoredDay(patient.admissionDate),
      },
      periods,
    });
  } catch (error) {
    console.error("Greška:", error);
    return res.status(500).json({
      success: false,
      message: "Greška pri generisanju budućih perioda",
    });
  }
};

export {getSpecification, activatePeriod, activateNextPeriod, activateExisting, getFutureSpecificationPeriods, getSpecificationHistory, getSpecificationById, addCostsToSpecification, saveBillingForSpecification, deleteSpecificationItem, calculatePreview}