import express from "express";
import type { Request, Response } from "express";
import Medicine from "../models/Medicine.js";
import Articles from "../models/Articles.js"; // ✔ ispravljeno ime modela
import Patient from "../models/Patient.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { toCyrillic, toLatin } from "../utils/script.js";
import { errorMessage } from "../utils/errors.js";

const router = express.Router();

// Pretraga otkriva imena pacijenata — dostupna samo prijavljenom osoblju
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    // Isti upit u oba pisma: podaci mogu biti uneti latinicom ili ćirilicom
    const q = query.slice(0, 100);
    const variants = [...new Set([q, toLatin(q), toCyrillic(toLatin(q))])].map(escapeRegex);
    const regex = new RegExp(variants.join("|"), "i");

    // Socijalni radnik vidi samo pacijente
    const patientsOnly = req.user.role === "social-worker";

    // 🟦 LEKOVI – sada vraća quantity i familyQuantity
    const medicines = patientsOnly ? [] : await Medicine.find({ name: regex })
      .limit(10)
      .select("_id name quantity familyQuantity");

    // 🟩 ARTIKLI
    const articles = patientsOnly ? [] : await Articles.find({ name: regex })
      .limit(10)
      .select("_id name quantity familyQuantity");

    // 🟧 PACIJENTI
    const patients = await Patient.find({
      $or: [{ name: regex }, { lastName: regex }],
    })
      .limit(10)
      .select("_id name lastName");

    const results = [
      ...medicines.map((m) => ({
        ...m.toObject(),
        type: "medicine",
      })),

      ...articles.map((a) => ({
        ...a.toObject(),
        type: "article",
      })),

      ...patients.map((p) => ({
        _id: p._id,
        name: `${p.name} ${p.lastName}`,
        type: "patient",
      })),
    ];

    return res.json({ success: true, results });

  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, error: errorMessage(error) });
  }
});

export default router;
