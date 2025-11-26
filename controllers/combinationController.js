import Analysis from "../models/Analysis.js";
import Combination from "../models/Combination.js";
import Specification from "../models/Specification.js";
import UsedCombinations from "../models/UsedCombinations.js";
import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";

// Dodavanje nove kombinacije
export const addCombination = async (req, res) => {
  try {
    const { name, analysisIds } = req.body;

    if (!name || !analysisIds || analysisIds.length === 0) {
      return res.status(400).json({ success: false, message: "Naziv i analize su obavezni." });
    }

    // Proveri da li sve analize postoje
    const analyses = await Analysis.find({ _id: { $in: analysisIds } });
    if (analyses.length !== analysisIds.length)
      return res.status(404).json({ success: false, message: "Neke analize nisu pronađene." });

    // Kreiraj kombinaciju (bez upisivanja cene u nju)
    const combination = new Combination({
      name,
      analyses: analysisIds,
      createdBy: req.user._id,
    });

    await combination.save();

    res.status(201).json({ success: true, combination });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// Dobavljanje svih kombinacija (grupisanje po broju analiza)
export const getCombinations = async (req, res) => {
  try {
    const combinations = await Combination.find()
      .populate("analyses", "name price")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

      const formatted = combinations.map((c) => {
      const totalPrice = c.analyses.reduce((sum, a) => sum + (a.price || 0), 0);
      return {
        _id: c._id,
        name: c.name,
        analyses: c.analyses,
        totalPrice,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
      };
    });

    res.status(200).json({ success: true, combinations: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addCombinationToPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { combinationId } = req.body;

    const combination = await Combination.findById(combinationId)
      .populate("analyses", "name price");

    if (!combination) {
      return res.status(404).json({ success: false, message: "Kombinacija nije pronađena" });
    }

    const analysesSnapshot = combination.analyses.map(a => ({
      _id: a._id,
      name: a.name,
      price: a.price
    }));

    const totalPriceAtTheTime = analysesSnapshot.reduce(
      (sum, a) => sum + (a.price || 0),
      0
    );

    const usedCombination = await UsedCombinations.create({
      patient: patientId,
      combination: combinationId,
      analyses: analysesSnapshot,
      totalPriceAtTheTime,
      createdBy: req.user._id
    });

    // 1️⃣ Uzimamo aktivnu specifikaciju
    const spec = await getOrCreateActiveSpecification(patientId);

    // 2️⃣ Dodajemo stavku u nju
    spec.items.push({
      name: combination.name,
      category: "combination",
      analyses: analysesSnapshot,
      price: totalPriceAtTheTime,
      date: new Date(),
    });

    spec.totalPrice =
    spec.items.reduce((sum, i) => sum + (i.price ?? 0), 0) +
    (spec.lodgingPrice ?? 0) +
    (spec.extraCosts ?? 0);
    await spec.save();

    return res.status(201).json({ success: true, usedCombination });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getUsedCombination = async (req, res) => {
  try {
    const {patientId} = req.params
    const usedCombinations = await UsedCombinations.find({patient: patientId})
    .populate("createdBy", "name role") // da dobiješ ime i ulogu
      .populate("combination", "name totalPrice") // ako hoćeš ime kombinacije i njenu cenu
      .exec();
    if(usedCombinations) {
      return res.status(200).json({success:true, usedCombinations})
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}


export const getPatientCombinations = async (req, res) => {
  const { patientId } = req.params;

  try {
    // Ovde povlačimo kombinacije pacijenta
    const combinations = await UsedCombinations.find({ patient: patientId })
      .populate("combination", "name totalPrice")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    if (!combinations || combinations.length === 0) {
      return res.status(200).json({ success: true, combinations: [] });
    }

    // Nema potrebe za populate("analyses") jer su već u dokumentu
    const formatted = combinations.map((c) => ({
      _id: c._id,
      combinationName: c.combination?.name || "Nepoznata kombinacija",
      totalPriceAtTheTime: c.totalPriceAtTheTime,
      createdBy: c.createdBy,
      createdAt: c.createdAt,
      analyses: c.analyses.map((a) => ({
         totalPrice : c.analyses.reduce((sum, a) => sum + (a.price || 0), 0),
        _id: a._id,
        name: a.name,
        price: a.price,
      })),
    }));

    return res.status(200).json({ success: true, combinations: formatted });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};




