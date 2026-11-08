import express from "express";
import type { Request, Response } from "express";
import Medicine from "../models/Medicine.js";
import Articles from "../models/Articles.js"; // ✔ ispravljeno ime modela
import Patient from "../models/Patient.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { wordStartQuery } from "../utils/searchRegex.js";
import { errorMessage } from "../utils/errors.js";

const router = express.Router();

// Pretraga otkriva imena pacijenata — dostupna samo prijavljenom osoblju
router.get("/", authMiddleware, async (req: Request, res: Response) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    // Po počecima reči, bez obzira na kvačice i pismo ("an" ne nalazi "Jovanović")
    const q = query.slice(0, 100);
    const byName = wordStartQuery(q, ["name"]);
    const byPerson = wordStartQuery(q, ["name", "lastName"]);
    if (!byName || !byPerson) return res.json({ success: true, results: [] });

    // Socijalni radnik vidi samo pacijente
    const patientsOnly = req.user.role === "social-worker" || req.user.role === "physiotherapist";

    const [medicines, articles, patients] = await Promise.all([
      patientsOnly ? [] : Medicine.find(byName).sort({ name: 1 }).limit(10).select("_id name quantity familyQuantity"),
      patientsOnly ? [] : Articles.find(byName).sort({ name: 1 }).limit(10).select("_id name quantity familyQuantity"),
      Patient.find(byPerson).sort({ dischargeDate: 1, lastName: 1 }).limit(10).select("_id name lastName"),
    ]);

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
