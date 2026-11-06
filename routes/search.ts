import express from "express";
import type { Request, Response } from "express";
import Medicine from "../models/Medicine.js";
import Articles from "../models/Articles.js"; // ✔ ispravljeno ime modela
import Patient from "../models/Patient.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { errorMessage } from "../utils/errors.js";

const router = express.Router();

// Pretraga otkriva imena pacijenata — dostupna samo prijavljenom osoblju
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    const regex = new RegExp(escapeRegex(query.slice(0, 100)), "i");

    // 🟦 LEKOVI – sada vraća quantity i familyQuantity
    const medicines = await Medicine.find({ name: regex })
      .limit(10)
      .select("_id name quantity familyQuantity");

    // 🟩 ARTIKLI
    const articles = await Articles.find({ name: regex })
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
