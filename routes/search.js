import express from "express";
import Medicine from "../models/Medicine.js";
import Articles from "../models/Articles.js"; // ✔ ispravljeno ime modela
import Patient from "../models/Patient.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const query = req.query.q?.trim();

    if (!query) {
      return res.json({ success: true, results: [] });
    }

    const regex = new RegExp(query, "i");

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
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
