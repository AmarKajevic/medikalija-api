import UsedMedicine from "../models/UsedMedicine.js";
import Patient from "../models/Patient.js";
import UsedArticles from "../models/UsedArticles.js";
import Diagnosis from "../models/Diagnosis.js";

export const getNurseActions = async (req, res) => {
  try {
    // samo admin i glavna sestra mogu da vide
    if (!["admin", "head_nurse"].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nedovoljno privilegija" });
    }

    const diagnoses = await Diagnosis.find()
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName");

    const articles = await UsedArticles.find()
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName")
      .populate("article", "name price");

    const medicines = await UsedMedicine.find()
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName")
      .populate("medicine", "name pricePerUnit");

    const nurseActions = [];

    // Dijagnoze
    diagnoses.forEach((d) => {
      if (d.createdBy?.role === "nurse") {
        nurseActions.push({
          type: "Dijagnoza",
          patient: `${d.patient?.name || ""} ${d.patient?.lastName || ""}`,
          createdBy: {
            _id: d.createdBy?._id,
            name: d.createdBy?.name || "Nepoznato",
            lastName: d.createdBy?.lastName || "",
            role: d.createdBy?.role || "",
          },
          description: d.description,
          createdAt: d.createdAt,
        });
      }
    });

    // Artikli
    articles.forEach((a) => {
      if (a.createdBy?.role === "nurse") {
        nurseActions.push({
          type: "Artikal",
          patient: `${a.patient?.name || ""} ${a.patient?.lastName || ""}`,
          createdBy: {
            _id: a.createdBy?._id,
            name: a.createdBy?.name || "Nepoznato",
            lastName: a.createdBy?.lastName || "",
            role: a.createdBy?.role || "",
          },
          description: `${a.article?.name || "Nepoznat artikal"} — ${a.amount} kom`,
          createdAt: a.createdAt,
        });
      }
    });

    // Lekovi
    medicines.forEach((m) => {
      if (m.createdBy?.role === "nurse") {
        nurseActions.push({
          type: "Lek",
          patient: `${m.patient?.name || ""} ${m.patient?.lastName || ""}`,
          createdBy: {
            _id: m.createdBy?._id,
            name: m.createdBy?.name || "Nepoznato",
            lastName: m.createdBy?.lastName || "",
            role: m.createdBy?.role || "",
          },
          description: `${m.medicine?.name || "Nepoznat lek"} — ${m.amount} kom`,
          createdAt: m.createdAt,
        });
      }
    });

    // sortiranje po datumu — najnovije prve
    nurseActions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json({ success: true, nurseActions });

  } catch (error) {
    console.log("❌ Greška u getNurseActions:", error);
    return res.status(500).json({ success: false, message: "Greška na serveru" });
  }
};
