import Article from "../models/Articles.js";
import Patient from "../models/Patient.js";
import PatientArticle from "../models/PatientArticle.js";
import UsedArticles from "../models/UsedArticles.js";
import User from "../models/User.js";

import { consumeForPatient } from "../services/specificationCharges.js";
import { createNotification } from "../services/notificationService.js";

// 🧠 Računanje pakovanja
function recalcPackages(article) {
  const u = article.unitsPerPackage || 0;

  if (u > 0) {
    article.packageCount = Math.floor((article.quantity || 0) / u);
    article.familyPackageCount = Math.floor((article.familyQuantity || 0) / u);
  } else {
    article.packageCount = 0;
    article.familyPackageCount = 0;
  }
}

// ➕ Dodavanje novog ili postojećeg artikla
const addArticle = async (req, res) => {
  try {
    const {
      name,
      price,
      fromFamily,
      packages,
      unitsPerPackage,
      quantity,
      patientId,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Naziv artikla je obavezan.",
      });
    }

    let totalUnitsAdded = 0;
    const pkgCount = Number(packages) || 0;
    const unitsPerPkg = Number(unitsPerPackage) || 0;
    const looseQty = Number(quantity) || 0;

    if (pkgCount > 0 && unitsPerPkg > 0) {
      totalUnitsAdded += pkgCount * unitsPerPkg;
    }
    if (looseQty > 0) {
      totalUnitsAdded += looseQty;
    }

    if (totalUnitsAdded === 0) {
      return res.status(400).json({
        success: false,
        message: "Morate uneti bar jedno pakovanje ili količinu.",
      });
    }

    // =========================================
    // PORODIČNI ARTIKAL
    // =========================================
    if (fromFamily) {
      if (!patientId) {
        return res.status(400).json({
          success: false,
          message: "Morate poslati patientId za porodične artikle.",
        });
      }

      const article = await Article.findOne({ name });
      if (!article) {
        return res.status(404).json({
          success: false,
          message: "Artikal mora prvo postojati u sistemu.",
        });
      }

      const patientArticle = await PatientArticle.findOneAndUpdate(
        { patient: patientId, article: article._id },
        { $inc: { quantity: totalUnitsAdded } },
        { new: true, upsert: true }
      );

      return res.status(200).json({
        success: true,
        message: "Porodični artikal dodat pacijentu.",
        patientArticle,
      });
    }

    // =========================================
    // DOMSKI ARTIKAL
    // =========================================
    // Cena je obavezna samo kada se dodaje domski artikal
    if (price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        message: "Cena je obavezna za artikle koje dodaje dom.",
      });
    }

    let article = await Article.findOne({ name });

    if (article) {
      // Ažuriranje postojećeg
      if (price !== undefined) {
        article.price = price;
      }
      if (!article.unitsPerPackage && unitsPerPkg > 0) {
        article.unitsPerPackage = unitsPerPkg;
      }
      article.quantity += totalUnitsAdded;
      recalcPackages(article);
      await article.save();
      return res.status(200).json({ success: true, article });
    }

    // Kreiranje novog domskog artikla
    const newArticle = new Article({
      name,
      price,
      quantity: totalUnitsAdded,
      unitsPerPackage: unitsPerPkg || 0,
      createdBy: req.user._id,
    });
    recalcPackages(newArticle);
    await newArticle.save();

    return res.status(201).json({ success: true, article: newArticle });
  } catch (error) {
    console.error("addArticle error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};



// 🔁 Ažuriranje artikla
const updateArticle = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      price,
      fromFamily,
      packages,
      unitsPerPackage,
      quantity,
      addQuantity,
    } = req.body;

    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({ success: false, message: "Artikal nije pronađen." });
    }

    if (price !== undefined) {
      article.price = Number(price);
    }

    if (unitsPerPackage !== undefined) {
      article.unitsPerPackage = Number(unitsPerPackage) || 0;
    }

    const u = article.unitsPerPackage || Number(unitsPerPackage) || 0;

    if (quantity !== undefined) {
      if (fromFamily) {
        article.familyQuantity = Number(quantity);
      } else {
        article.quantity = Number(quantity);
      }
    }

    if (addQuantity !== undefined) {
      if (fromFamily) {
        article.familyQuantity += Number(addQuantity);
      } else {
        article.quantity += Number(addQuantity);
      }
    }

    const pkgCount = Number(packages) || 0;
    if (pkgCount > 0 && u > 0) {
      const unitsToAdd = pkgCount * u;
      if (fromFamily) {
        article.familyQuantity += unitsToAdd;
      } else {
        article.quantity += unitsToAdd;
      }
    }

    recalcPackages(article);
    await article.save();

    return res.status(200).json({ success: true, article });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 🗑️ Brisanje artikla
const deleteArticle = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await Article.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Artikal nije pronađen." });
    }
    return res.status(200).json({ success: true, message: "Artikal je izbrisan." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 📄 Dohvati sve artikle
const getArticles = async (req, res) => {
  try {
    const articles = await Article.find().sort({ name: 1 });
    return res.status(200).json({ success: true, articles });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// 📄 Dohvati jedan artikal
const getArticle = async (req, res) => {
  const { id } = req.params;
  try {
    const article = await Article.findById(id);
    if (!article) {
      return res.status(404).json({ success: false, message: "Artikal nije pronađen." });
    }
    return res.status(200).json({ success: true, article });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const addArticleToPatient = async (req, res) => {
  try {
    const { patientId, articleId, amount } = req.body;

    const patient = await Patient.findById(patientId);
    if (!patient) return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });

    const result = await consumeForPatient("article", {
      patientId,
      itemId: articleId,
      amount,
      user: req.user,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("useArticle error:", error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
};



// 📄 Istorija potrošnje pacijenta
const getPatientArticles = async (req, res) => {
  const { patientId } = req.params;
  console.log("➡️ getPatientArticles patientId:", patientId); // dodaj za proveru
  try {
    const articles = await UsedArticles.find({ patient: patientId }) // <--- OVO!
      .populate("article", "name price")
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    return res.status(200).json({ success: true, articles });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getPatientStockArticles = async (req, res) => {
  try {
    const{patientId} = req.params;

    const patientArticles = await PatientArticle.find({
      patient: patientId, quantity: {$gt: 0},
    }).populate("article", "name unitsPerPackage")

    

    // Artikal je mogao biti obrisan iz šifarnika — takve zapise preskačemo
    const formatted = patientArticles.filter((pa) => pa.article).map((pa) => ({
      _id: pa.article._id,
      name: pa.article.name,
      familyQuantity: pa.quantity,
      unitsPerPackage: pa.article.unitsPerPackage || 0,
      familyPackageCount: pa.article.unitsPerPackage > 0 ? Math.floor(pa.quantity/ pa.article.unitsPerPackage) : 0

      
    }) );
    
    return res.status(200).json({
      success: true,
      message:"artikli pronadjeni",
      articles: formatted,
    })
  } catch (error) {
    console.log("getPatientStockArticles error:", error)
    return res.status(500).json({
      success: false,
      message: error.message
    })
    
  }
}


export {
  addArticle,
  updateArticle,
  deleteArticle,
  getArticles,
  getArticle,
  addArticleToPatient,
  getPatientArticles,
  getPatientStockArticles
};
