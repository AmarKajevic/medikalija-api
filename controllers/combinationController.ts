import Analysis from "../models/Analysis.js";
import Combination from "../models/Combination.js";
import CombinationGroup from "../models/CombinationGroup.js";
import UsedCombinations from "../models/UsedCombinations.js";
import { addCombinationCharge } from "../services/specificationCharges.js";
import type { Request, Response } from "express";
import { errorMessage, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import type { NamedRef, PricedRef, UserRef } from "../models/populated.js";

// Dodavanje nove kombinacije
export const addCombination = async (req: Request, res: Response) => {
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
    res.status(500).json({ success: false, message: errorMessage(error) });
  }
};


// Dobavljanje svih kombinacija (grupisanje po broju analiza)
export const addCombinationToPatient = async (req: Request, res: Response) => {
  try {
    const patientId = param(req, "patientId");
    const { combinationId, specificationId } = req.body;

    const combination = await Combination.findById(combinationId)
      .populate<{ analyses: PricedRef[] }>("analyses", "name price");

    if (!combination) {
      return res.status(404).json({
        success: false,
        message: "Kombinacija nije pronađena"
      });
    }

    const result = await addCombinationCharge({ patientId, combination, user: req.user, specificationId });

    return res.status(201).json({ success: true, ...result });
  } catch (error) {
    console.error("addCombinationToPatient error:", error);
    return res.status(statusOf(error)).json({
      success: false,
      message: errorMessage(error)
    });
  }
};

export const getPatientCombinations = async (req: Request, res: Response) => {
  const patientId = param(req, "patientId");

  try {
    // Ovde povlačimo kombinacije pacijenta
    const combinations = await UsedCombinations.find({ patient: patientId })
      .populate<{ combination: NamedRef | null }>("combination", "name totalPrice")
      .populate<{ createdBy: UserRef | null }>("createdBy", "name role")
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
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};
// ✅ BRISANJE KOMBINACIJE
export const deleteCombination = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");

    const deleted = await Combination.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Kombinacija nije pronađena",
      });
    }

    // ✅ Obriši kombinaciju i iz svih grupa gde postoji
    await CombinationGroup.updateMany(
      {},
      { $pull: { combinations: { _id: id } } }
    );

    return res.status(200).json({
      success: true,
      message: "Kombinacija uspešno obrisana",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: errorMessage(error) });
  }
};




