import Analysis from "../models/Analysis.js";
import Combination from "../models/Combination.js";
import UsedAnalysis from "../models/UsedAnalysis.js";
import Patient from "../models/Patient.js"
import Specification from "../models/Specification.js";
import { createNotification } from "../services/notificationService.js";



const addAnalysis = async (req, res) => {
    
    try {
        const {name, price} = req.body;
        const analysis = new Analysis({
            name,
            price,
            createdBy: req.user.id,
        })
        await analysis.save()
        res.status(201).json({success: true, analysis})
    } catch (error) {
        return res.status(500).json({success: false, message: error.message})
    }
}
const updateAnalysis = async (req, res) => {
    
    try {
        const {analysisId} = req.params
        const {price} = req.body

        const newAnalysis = await Analysis.findByIdAndUpdate(analysisId, {price}, {new: true})
        if(!newAnalysis) {
            return res.status(404).json({success: false, message: "Analiza nije pronadjena"})
        }
        res.status(200).json({success: true, newAnalysis})
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
const deleteAnalysis = async (req, res) => {
    try {
        const {analysisId} = req.params
        const deleteAnalysis = await Analysis.findByIdAndDelete(analysisId)
        if(!deleteAnalysis) {
            return res.status(404).json({success: false, message: "Analiza nije pronadjena"})
        }
        return res.status(200).json({success:true, deleteAnalysis})
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
const getAnalyses = async (req, res) => {
    try {
        const { search } = req.query;
        let filter = {};
        if (search) {
        filter = { name: { $regex: search, $options: "i" } }; // case insensitive
        }
        const analyses = await Analysis.find(filter).sort({ name: 1 });
        res.status(200).json({ success: true, analyses });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
    };

const addAnalysisToPatient = async (req, res) => {
  try {
    const { patientId, analysisId } = req.body;

    const patient = await Patient.findById(patientId); // ❗ NEDOSTAJAO

    const analysis = await Analysis.findById(analysisId);
    if (!analysis) return res.status(404).json({ success: false, message: "Analiza nije pronađena" });

    const usedAnalysis = new UsedAnalysis({
      patient: patientId,
      analysis: analysisId,
      priceAtTheTime: analysis.price,
      createdBy: req.user._id,
    });

    await Specification.findOneAndUpdate(
      { patientId },
      {
        $push: {
          items: {
            name: analysis.name,
            category: "analysis",
            price: analysis.price,
            date: new Date(),
          },
        },
        $inc: { totalPrice: analysis.price },
      },
      { upsert: true, new: true }
    );

    await usedAnalysis.save();

    // 📌 OBAVEŠTENJE


    res.status(200).json({ success: true, usedAnalysis });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


const getPatientAnalyses = async (req, res) => {
    try {
        const {patientId} = req.params
        const analyses = await UsedAnalysis.find({patient: patientId})
        .populate("analysis","name")
        .populate("createdBy","name role")
        .sort({createdAt: -1})

        return res.status(200).json({success: true, analyses})
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
// analysisController.js
const assignCombinationToPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { combinationId } = req.body;

    if (!patientId || !combinationId) {
      return res.status(400).json({
        success: false,
        message: "PatientId i CombinationId su obavezni.",
      });
    }

    // Nađi pacijenta
    const patient = await Patient.findById(patientId);
    if (!patient)
      return res
        .status(404)
        .json({ success: false, message: "Pacijent nije pronađen." });

    // Nađi kombinaciju
    const combination = await Combination.findById(combinationId).populate(
      "analyses",
      "name price"
    );
    if (!combination)
      return res
        .status(404)
        .json({ success: false, message: "Kombinacija nije pronađena." });

    // Za svaku analizu u kombinaciji kreiraj UsedAnalysis snapshot
    const usedAnalyses = await Promise.all(
      combination.analyses.map(async (a) => {
        const used = new UsedAnalysis({
          patient: patient._id,
          analysis: a._id,
          priceAtTheTime: a.price,
          createdBy: req.user._id,
          combinationId: combination._id,
          assignedAt: new Date(),
        });

        // Sačuvaj analizu u specifikaciju
        await Specification.findOneAndUpdate(
          { patientId: patient._id },
          {
            $push: {
              items: {
                name: a.name,
                category: "combination",
                price: a.price,
                date: new Date(),
              },
            },
            $inc: { totalPrice: a.price },
          },
          { upsert: true, new: true }
        );

        await used.save();
        return used;
      })
    );

    // Dodaj kombinaciju pacijentu (ako želiš da pratiš istoriju kombinacija)
    patient.combinations.push(combination._id);
    await patient.save();

    res.status(200).json({
      success: true,
      message: "Kombinacija dodeljena pacijentu i dodata u specifikaciju.",
      usedAnalyses,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};



const getAssignedCombinations = async (req, res) => {
  try {
    const { patientId } = req.params;

    // Dohvati sve usedAnalyses za pacijenta
    const usedAnalyses = await UsedAnalysis.find({ patient: patientId })
      .populate("analysis", "name")        // da dobijemo ime analize
      .sort({ assignedAt: -1 });

    res.status(200).json({ success: true, usedAnalyses });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const addCombination = async (req, res) => {
    try {
    const { name, analysisIds, group } = req.body;

    if (!name || !analysisIds || analysisIds.length === 0) {
      return res.status(400).json({ success: false, message: "Ime i analize su obavezne." });
    }
     // Nađemo sve analize
    const analyses = await Analysis.find({ _id: { $in: analysisIds } });
    if (!analyses || analyses.length === 0) {
      return res.status(404).json({ success: false, message: "Analize nisu pronađene." });
    }
    // Izračunamo cenu
    const totalPrice = analyses.reduce((sum, a) => sum + (a.priceAtTheTime || 0), 0);

    const combination = new Combination({
      name,
      analyses: analysisIds,
      totalPrice,
      group: group || "Bez grupe",
    });

    await combination.save();

    res.status(201).json({ success: true, message: "Kombinacija dodata", combination });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};
const getCombinations = async (req, res) => {
  try {
    const combinations = await Combination.find().populate("analyses");

    // grupisanje po polju "group"
    const grouped = combinations.reduce((acc, combo) => {
      if (!acc[combo.group]) acc[combo.group] = [];
      acc[combo.group].push(combo);
      return acc;
    }, {});

    res.status(200).json({ success: true, combinations: grouped });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};





export{
    addAnalysis,
    updateAnalysis,
    deleteAnalysis,
    getAnalyses,
    addAnalysisToPatient,
    getPatientAnalyses,
    assignCombinationToPatient,
    getAssignedCombinations, 
    addCombination, 
    getCombinations
    }