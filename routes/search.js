import express from "express";
import Medicine from "../models/Medicine.js";
import Articles from "../models/Articles.js";
import Patient from "../models/Patient.js";


const router = express.Router();

// /api/search?q=bruf
router.get("/", async (req, res) => {
  try {
    const query = req.query.q?.trim();

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    const regex = new RegExp(query, "i");

    // 🔍 Pretraga lekova
    const medicines = await Medicine.find({ name: regex })
      .limit(10)
      .select("_id name");

    // 🔍 Pretraga artikala
    const articles = await Articles.find({ name: regex })
      .limit(10)
      .select("_id name");

    // 🔍 Pretraga pacijenata
    const patients = await Patient.find({
      $or: [{ name: regex }, { lastName: regex }],
    })
      .limit(10)
      .select("_id name lastName");

    // Formatiramo sve rezultate u jedan niz
    const results = [
      ...medicines.map((m) => ({ ...m.toObject(), type: "medicine" })),
      ...articles.map((a) => ({ ...a.toObject(), type: "article" })),
      ...patients.map((p) => ({
        _id: p._id,
        name: `${p.name} ${p.lastName}`,
        type: "patient",
      })),
    ];

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, message: "Search error", error: error.message });
  }
});

export default router;
