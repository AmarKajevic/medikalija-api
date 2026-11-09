import mongoose from "mongoose";
import Patient from "../models/Patient.js";
import Specification from "../models/Specification.js"
import {
  getActiveSpecification,
  getBillingPeriodSpecification,
  activateSpecificationPeriod,
  activateExistingSpecification,
  activateNextSpecificationPeriod,
  buildSpecificationSchedule,
  futureScheduleHorizon,
  listPastPeriods,
  listSelectablePeriods,
  openPastPeriod,
  changeSpecificationDates,
  listNonStandardPeriods,
  openNonStandardPeriod,
  setBillingPeriod,
} from "../services/getOrCreateActiveSpecification.js";
import GlobalSetting from "../models/GlobalSetting.js";
import { nextPeriodAfter, normalizeStoredDay } from "../utils/dateUtils.js";
import { MANAGER_ROLES, addExtraCharge, removeSpecItem, setSpecItemAmount } from "../services/specificationCharges.js";
import type { Request, Response } from "express";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";

const getSpecification = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");

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
    return res.status(500).json({ success: false, message: errorMessage(err) });
  }
};

// Period specifikacije: period pre aktivnog (poslednji istekao); null ako ga nema
const getBillingPeriod = async (req: Request, res: Response) => {
  try {
    const specification = await getBillingPeriodSpecification(param(req, "patientId"));
    return res.json({ success: true, specification });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Svi raniji periodi (od prijema), od najnovijeg
const getPastPeriods = async (req: Request, res: Response) => {
  try {
    const periods = await listPastPeriods(param(req, "patientId"));
    return res.json({ success: true, periods });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Periodi među kojima se bira aktivan: od prijema do današnjeg i jedan unapred
const getSelectablePeriods = async (req: Request, res: Response) => {
  try {
    const periods = await listSelectablePeriods(param(req, "patientId"));
    return res.json({ success: true, periods });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Vanstandardni periodi (ručni datumi van redovnog niza)
const getNonStandardPeriods = async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, specifications: await listNonStandardPeriods(param(req, "patientId")) });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

const openNonStandard = async (req: Request, res: Response) => {
  try {
    const specification = await openNonStandardPeriod(param(req, "patientId"), req.body?.startDate, req.body?.endDate);
    return res.json({ success: true, specification });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Ručna izmena datuma perioda; periodi koji slede se pomeraju
const changeDates = async (req: Request, res: Response) => {
  try {
    const specification = await changeSpecificationDates(param(req, "patientId"), param(req, "specId"), req.body?.startDate, req.body?.endDate);
    return res.json({ success: true, specification });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Otvara raniji period za rad, bez menjanja aktivnog
const openPeriod = async (req: Request, res: Response) => {
  try {
    const specification = await openPastPeriod(param(req, "patientId"), req.body?.startDate, req.body?.endDate);
    return res.json({ success: true, specification });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// Izbor perioda specifikacije { specificationId } ili { startDate, endDate };
// smeštaj za period (aktivan) se postavlja sam — period posle njega
const chooseBillingPeriod = async (req: Request, res: Response) => {
  try {
    const { billing, active } = await setBillingPeriod(param(req, "patientId"), req.body ?? {});
    return res.json({ success: true, specification: billing, active });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// ✅ RUČNO AKTIVIRANJE PERIODA (nadoknada propuštenog perioda ili ručni izbor)
const activatePeriod = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");
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
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// ✅ AKTIVIRANJE SLEDEĆEG PERIODA (nadovezuje se na trenutno aktivan, računa server)
const activateNextPeriod = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");

    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate period specifikacije" });
    }

    const spec = await activateNextSpecificationPeriod(patientId);
    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("activateNextPeriod error:", err);
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

// ✅ REAKTIVIRANJE POSTOJEĆEG PERIODA IZ ISTORIJE (po ID-u, bez nagađanja datuma)
const activateExisting = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");
    const specId = param(req, "specId");

    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate period specifikacije" });
    }

    const spec = await activateExistingSpecification(patientId, specId);
    return res.json({ success: true, specification: spec });
  } catch (err) {
    console.error("activateExisting error:", err);
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};
// ✅ DODAVANJE DODATNIH TROŠKOVA
const addCostsToSpecification = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { extraCostAmount, extraCostLabel } = req.body;

    if (!MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate specifikaciju." });
    }

    const spec = await Specification.findById(id);
    if (!spec) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena." });
    }

    const saved = await addExtraCharge(spec, {
      label: extraCostLabel,
      amount: Number(extraCostAmount),
      user: req.user,
    });

    return res.json({ success: true, specification: saved });
  } catch (err) {
    console.error("addCostsToSpecification error:", err);
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};
// controllers/specificationController.js (nastavak)


// Naziv izabrane cene smeštaja (npr. "30 dana") za prikaz i štampu
const optionLabel = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

const saveBillingForSpecification = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { previousDebtEUR, nextLodgingEUR, earlyLodgingEUR } = req.body; // backend više ne očekuje kurseve
    // Dug, smeštaj i vanstandardni period smeštaja su opcioni: isključeni se ne naplaćuju i ne štampaju
    const includeDebt = req.body.includeDebt === undefined ? Number(previousDebtEUR) > 0 : req.body.includeDebt === true;
    const includeLodging = req.body.includeLodging === undefined ? Number(nextLodgingEUR) > 0 : req.body.includeLodging === true;
    const includeEarlyLodging = req.body.includeEarlyLodging === undefined ? Number(earlyLodgingEUR) > 0 : req.body.includeEarlyLodging === true;

    const spec = await Specification.findById(id);
    if (!spec) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena" });
    }

    // Dohvati globalne kurseve
    const globalSettings = await GlobalSetting.findOne();
    const low = globalSettings?.lowerExchangeRate || 0;
    const mid = globalSettings?.middleExchangeRate || 0;

    const debtEUR = includeDebt ? Math.max(Number(previousDebtEUR) || 0, 0) : 0;
    const lodgingEUR = includeLodging ? Math.max(Number(nextLodgingEUR) || 0, 0) : 0;
    const earlyEUR = includeEarlyLodging ? Math.max(Number(earlyLodgingEUR) || 0, 0) : 0;
    const specTotalRSD = spec.totalPrice ?? 0;

    const specEUR = low > 0 ? specTotalRSD / low : 0;
    const debtRSD = mid > 0 ? debtEUR * mid : 0;
    const lodgingRSD = mid > 0 ? lodgingEUR * mid : 0;
    const earlyRSD = mid > 0 ? earlyEUR * mid : 0;
    const totalRSD = specTotalRSD + debtRSD + lodgingRSD + earlyRSD;
    const totalEUR = specEUR + debtEUR + lodgingEUR + earlyEUR;

    // Naredni period: dan posle kraja specifikacije + 30 kalendarskih dana
    const { startDate: nextPeriodStart, endDate: nextPeriodEnd } =
      nextPeriodAfter(normalizeStoredDay(spec.endDate) ?? spec.endDate);

    spec.billing = {
      lowerExchangeRate: low,
      middleExchangeRate: mid,
      includeDebt,
      includeLodging,
      previousDebtEUR: debtEUR,
      previousDebtRSD: debtRSD,
      nextLodgingEUR: lodgingEUR,
      nextLodgingRSD: lodgingRSD,
      nextLodgingOption: includeLodging ? optionLabel(req.body.nextLodgingOption) : "",
      includeEarlyLodging,
      earlyLodgingEUR: earlyEUR,
      earlyLodgingRSD: earlyRSD,
      earlyLodgingOption: includeEarlyLodging ? optionLabel(req.body.earlyLodgingOption) : "",
      earlyLodgingNote: includeEarlyLodging && typeof req.body.earlyLodgingNote === "string" ? req.body.earlyLodgingNote.trim().slice(0, 300) : "",
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
    return res.status(500).json({ success: false, message: errorMessage(err) });
  }
};


// 📌 VRATI istoriju + aktivnu specifikaciju
// Lista perioda bez samih stavki (broj stavki se računa u bazi) — za pacijenta sa
// godinama perioda odgovor je nekoliko KB umesto stotina; stavke se učitavaju po periodu.
const getSpecificationHistory = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");
    if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ message: "Neispravan pacijent." });

    const [specs, patient] = await Promise.all([
      Specification.aggregate([
        { $match: { patientId: new mongoose.Types.ObjectId(patientId) } },
        { $sort: { startDate: -1 } },
        {
          $project: {
            startDate: 1,
            endDate: 1,
            isActive: 1,
            nonStandard: 1,
            totalPrice: 1,
            "billing.totalEUR": 1,
            "billing.totalRSD": 1,
            itemsCount: { $size: { $ifNull: ["$items", []] } },
          },
        },
      ]),
      Patient.findById(patientId, { dischargeDate: 1 }).lean(),
    ]);

    // Aktivan period je onaj eksplicitno markiran isActive:true (osim ako je
    // pacijent otpušten — tada su sve specifikacije istorija).
    const activeSpec = patient?.dischargeDate ? null : specs.find((s) => s.isActive) || null;
    const history = specs.filter((s) => !activeSpec || String(s._id) !== String(activeSpec._id));

    return res.json({ activeSpec, history });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Greška pri učitavanju istorije." });
  }
};



// Vraća pojedinačnu specifikaciju po ID
const getSpecificationById = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const specification = await Specification.findById(id);
    if (!specification) {
      return res.status(404).json({ success: false, message: "Specifikacija nije pronađena." });
    }
    return res.json({ success: true, specification });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: errorMessage(err) });
  }
};
// ✅ BRISANJE STAVKE IZ SPECIFIKACIJE (vraća stanje na lager i briše zapis o potrošnji)
// Izmena količine stavke (lek/artikal menja i stanje doma)
const updateSpecificationItemAmount = async (req: Request, res: Response) => {
  try {
    const specification = await setSpecItemAmount(param(req, "specId"), param(req, "itemId"), req.body?.amount, req.user, req.body?.unitPrice);
    return res.json({ success: true, message: "Količina je izmenjena.", specification });
  } catch (err) {
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};

const deleteSpecificationItem = async (req: Request, res: Response) => {
  try {
    const specId = param(req, "specId");
    const itemId = param(req, "itemId");

    if (!MANAGER_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da menjate specifikaciju." });
    }

    const { specification, fullyReverted } = await removeSpecItem(specId, itemId);

    return res.json({
      success: true,
      message: fullyReverted
        ? "Stavka obrisana."
        : "Stavka obrisana. Ovo je starija stavka — stanje na lageru nije automatski vraćeno.",
      fullyReverted,
      specification,
    });
  } catch (err) {
    console.error("deleteSpecificationItem:", err);
    return res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};
const calculatePreview = (req: Request, res: Response) => {
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



// 📅 RASPORED 30-DNEVNIH PERIODA (od prijema do 20 godina unapred)
const getFutureSpecificationPeriods = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });
    }

    const until = futureScheduleHorizon(patient.admissionDate);
    const periods = buildSpecificationSchedule(patient.admissionDate, until, undefined, await Specification.find({ patientId, nonStandard: { $ne: true } }));

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

export {chooseBillingPeriod, getNonStandardPeriods, openNonStandard, updateSpecificationItemAmount, getSpecification, getBillingPeriod, getPastPeriods, getSelectablePeriods, openPeriod, changeDates, activatePeriod, activateNextPeriod, activateExisting, getFutureSpecificationPeriods, getSpecificationHistory, getSpecificationById, addCostsToSpecification, saveBillingForSpecification, deleteSpecificationItem, calculatePreview}
