import Specification from "../models/Specification.js";
import Patient from "../models/Patient.js";

export async function getOrCreateActiveSpecification(patientId) {
  const patient = await Patient.findById(patientId);
  if (!patient) return null;

  // ❌ Ako pacijent ima ručni otpust → nikad ne pravimo novu specifikaciju
  if (patient.dischargeDate) return null;

  const admissionDate = new Date(patient.admissionDate);

  // ✅ Normalizujemo TODAY na početak dana
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // === Korak 1: izračunaj broj dana od prijema ===
  const diffDays = Math.floor(
    (today - admissionDate) / (1000 * 60 * 60 * 24)
  );

  // === Korak 2: odredi koji je trenutno 30-dnevni period ===
  const periodIndex = Math.floor(diffDays / 30);

  // === Korak 3: izračunaj startDate za ovaj period ===
  const startDate = new Date(admissionDate);
  startDate.setDate(startDate.getDate() + periodIndex * 30);

  // === Korak 4: izračunaj endDate (30 dana uključujući poslednji dan) ===
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 29);

  // === Korak 5: potraži postojecu specifikaciju za ovaj period ===
  let spec = await Specification.findOne({ patientId, startDate, endDate });

  // === Korak 6: Ako ne postoji – kreiraj je ===
  if (!spec) {
    spec = await Specification.create({
      patientId,
      items: [],
      totalPrice: 0,
      startDate,
      endDate,
    });
  }

  return spec;
}


export const getFutureSpecificationPeriods = async (req, res) => {
  try {
    const { patientId } = req.params;

    const patient = await Patient.findById(patientId);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen" });
    }

    const admissionDate = new Date(patient.admissionDate);

    // === 5 GODINA U DANIMA ===
    const tenYears = 10 * 365;

    const periods = [];
    let currentStart = new Date(admissionDate);

    // Generate periods while within 5 years from admission
    for (let i = 0; i < Math.floor(tenYears / 30); i++) {
      const startDate = new Date(currentStart);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 29); // 30 dana

      periods.push({
        index: i + 1,
        startDate,
        endDate,
      });

      // Pomeri start za sledeći ciklus
      currentStart.setDate(currentStart.getDate() + 30);
    }

    return res.status(200).json({
      success: true,
      patient: {
        id: patient._id,
        name: patient.name,
        lastName: patient.lastName,
      },
      periods,
    });

  } catch (error) {
    console.error("Greška:", error);
    return res.status(500).json({
      success: false,
      message: "Greška pri generisanju budućih perioda",
    });
  }
};


