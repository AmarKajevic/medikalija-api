import Article from "../models/Articles.js";
import Patient from "../models/Patient.js";
import UsedArticles from "../models/UsedArticles.js";
import User from "../models/User.js";

import { getOrCreateActiveSpecification } from "../services/getOrCreateActiveSpecification.js";
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
    } = req.body;

    // if (!name || price == null) {
    //   return res.status(400).json({ success: false, message: "Naziv i cena su obavezni." });
    // }
    // Naziv uvek mora da postoji
    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Naziv artikla je obavezan.",
      });
    }

    // Cena je obavezna SAMO ako lek dodaje DOM (NE porodica)
    if (!fromFamily && pricePerUnit == null) {
      return res.status(400).json({
        success: false,
        message: "Cena je obavezna za lekove koje dodaje dom.",
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
        message: "Morate uneti bar jedno pakovanje ili broj komada (quantity).",
      });
    }

    let article = await Article.findOne({ name, createdBy: req.user._id });

    if (article) {
      // postoji → update
      if (price !== undefined) {
        article.price = price;
      }

      if (!article.unitsPerPackage && unitsPerPkg > 0) {
        article.unitsPerPackage = unitsPerPkg;
      }

      if (fromFamily) {
        article.familyQuantity += totalUnitsAdded;
      } else {
        article.quantity += totalUnitsAdded;
      }

      recalcPackages(article);
      await article.save();

      return res.status(200).json({ success: true, article });
    }

    // novi artikal
    const baseUnitsPerPackage = unitsPerPkg > 0 ? unitsPerPkg : 0;

    const homeQty = fromFamily ? 0 : totalUnitsAdded;
    const familyQty = fromFamily ? totalUnitsAdded : 0;

    const newArticle = new Article({
      name,
      price,
      quantity: homeQty,
      familyQuantity: familyQty,
      unitsPerPackage: baseUnitsPerPackage,
      createdBy: req.user._id,
    });

    recalcPackages(newArticle);
    await newArticle.save();

    return res.status(201).json({ success: true, article: newArticle });
  } catch (error) {
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

    console.log("🟦 addArticleToPatient pozvan!", req.body);

    // 1) PACIJENT
    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });
    }

    // 2) ARTIKAL
    const article = await Article.findById(articleId);
    if (!article) {
      return res.status(404).json({ success: false, message: "Artikal nije pronađen" });
    }

    // =====================================================
    // 🔵  A) SESTRA — NE SME da menja zalihe i NE ulazi u specifikaciju
    // =====================================================
    if (req.user.role === "nurse") {
      console.log("➡️ Sestra dodaje artikal — NE diram stanje!");

      const usedArticle = await UsedArticles.create({
        patient: patientId,
        article: articleId,
        priceAtTheTime: article.price,
        amount,
        createdBy: req.user._id,
        roleUsed: req.user.role,
      });

      // Notifikacije (vlasnik + glavna sestra)
      await createNotification(
        patient.createdBy,
        "article",
        `${req.user.name} ${req.user.lastName} je dodala artikal pacijentu ${patient.name} ${patient.lastName}.`
      );

      const headNurse = await User.findOne({ role: "head_nurse" });
      if (headNurse) {
        await createNotification(
          headNurse._id,
          "article",
          `Sestra ${req.user.name} je dodala artikal pacijentu ${patient.name}.`
        );
      }

      return res.status(200).json({
        success: true,
        message: "Sestra je dodala artikal — stanje se NE umanjuje i NE ulazi u specifikaciju.",
        usedArticle,
      });
    }

    // =====================================================
    // 🔴  B) ADMIN / VLASNIK — SKIDA SA ZALIHA + SPECIFIKACIJA
    // =====================================================

    const totalAvailable = article.familyQuantity + article.quantity;
    if (totalAvailable < amount) {
      return res.status(400).json({
        success: false,
        message: "Nedovoljno ukupno artikala na stanju",
      });
    }

    let fromFamily = 0;
    let fromStock = 0;

    if (article.familyQuantity >= amount) {
      fromFamily = amount;
      article.familyQuantity -= amount;
    } else {
      fromFamily = article.familyQuantity;
      fromStock = amount - fromFamily;

      if (article.quantity < fromStock) {
        return res.status(400).json({
          success: false,
          message: "Nema dovoljno artikala u magacinu",
        });
      }

      article.familyQuantity = 0;
      article.quantity -= fromStock;
    }

    await article.save();

    // Upis u UsedArticles
    const usedArticle = await UsedArticles.create({
      patient: patientId,
      article: articleId,
      priceAtTheTime: article.price,
      amount,
      createdBy: req.user._id,
      roleUsed: req.user.role,
    });

    // =====================================================
    // 🟣 SPECIFIKACIJA — samo deo iz magacina
    // =====================================================
    if (fromStock > 0) {
      const spec = await getOrCreateActiveSpecification(patientId);

      const cost = fromStock * article.price;

      // -----------------------------------------------------
      // 🔥 PROVERA DA LI VEĆ POSTOJI U SPECIFIKACIJI
      // -----------------------------------------------------
      const existingItem = spec.items.find(
        (i) =>
          i.category === "article" &&
          i.name === article.name
      );

      if (existingItem) {
        // 🔥 Update umesto dodavanja
        existingItem.amount += fromStock;
        existingItem.price += cost;
      } else {
        // ➕ Dodaj novi item
        spec.items.push({
          name: article.name,
          category: "article",
          amount: fromStock,
          price: cost,
          date: new Date(),
        });
      }

      // Recalculate totalPrice
      spec.totalPrice =
        spec.items.reduce((sum, i) => sum + (i.price ?? 0), 0) +
        (spec.extraCosts ?? 0);

      await spec.save();
    }

    return res.status(200).json({ success: true, usedArticle });

  } catch (error) {
    console.error("❌ addArticleToPatient FATAL ERROR:", error);
    return res.status(500).json({ success: false, message: error.message });
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


export {
  addArticle,
  updateArticle,
  deleteArticle,
  getArticles,
  getArticle,
  addArticleToPatient,
  getPatientArticles,
};
