import Specification from "../models/Specification.js";
import Patient from "../models/Patient.js";

// Normalizuje na UTC ponoć na osnovu kalendarskih Y/M/D vrednosti ulaznog datuma,
// bez zavisnosti od vremenske zone servera. `setHours()` resetuje u LOKALNOJ zoni,
// pa bi npr. na serveru sa UTC+2 zonom pomerio "2026-09-05" (UTC ponoć) na
// "2026-09-04T22:00:00.000Z" — što razbija tačno poređenje datuma pri traženju
// postojeće specifikacije za isti period.
function toUtcMidnight(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return d; // ostaje Invalid Date, provereno kod pozivaoca
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Vraća period koji je admin eksplicitno označio kao aktivan (isActive: true).
// Ako takav ne postoji (nov pacijent ili stari podaci bez flaga), samoispravljanje:
// koristi se stara logika (period po admissionDate + "danas") i taj period se
// markira kao aktivan, tako da nema potrebe za posebnom migracionom skriptom.
export async function getActiveSpecification(patientId) {
  const patient = await Patient.findById(patientId);
  if (!patient) return null;
  if (patient.dischargeDate) return null;

  const existing = await Specification.findOne({ patientId, isActive: true });
  if (existing) return existing;

  const fallback = await getOrCreateActiveSpecification(patientId);
  if (fallback) {
    fallback.isActive = true;
    await fallback.save();
  }
  return fallback;
}

// Deaktivira sve ostale specifikacije pacijenta i aktivira prosleđenu.
async function setActiveSpec(patientId, spec) {
  await Specification.updateMany(
    { patientId, _id: { $ne: spec._id } },
    { $set: { isActive: false } }
  );
  spec.isActive = true;
  await spec.save();
  return spec;
}

// Kreira (ili, ako se ista sesija dva puta pozove sa istim opsegom, ponovo
// koristi) NOVI period po ručno unetom opsegu datuma i postavlja ga kao aktivan.
// Napomena: postojeće automatski kreirane specifikacije u bazi mogu imati
// startDate/endDate izračunate starom logikom (lokalna vremenska zona servera
// umešana u proračun preko admissionDate) — ova funkcija NE pokušava da ih
// pogodi tačnim poklapanjem datuma. Za vraćanje na POSTOJEĆI raniji period
// koristi se `activateExistingSpecification` po ID-u (bez nagađanja datuma).
export async function activateSpecificationPeriod(patientId, startDate, endDate) {
  const patient = await Patient.findById(patientId);
  if (!patient) {
    const err = new Error("Pacijent nije pronađen");
    err.status = 404;
    throw err;
  }

  const start = toUtcMidnight(startDate);
  const end = toUtcMidnight(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
    const err = new Error("Neispravan opseg datuma");
    err.status = 400;
    throw err;
  }

  let spec = await Specification.findOne({ patientId, startDate: start, endDate: end });

  if (!spec) {
    spec = await Specification.create({
      patientId,
      items: [],
      totalPrice: 0,
      startDate: start,
      endDate: end,
      isActive: false,
    });
  }

  return setActiveSpec(patientId, spec);
}

// Reaktivira POSTOJEĆU specifikaciju po ID-u (npr. iz istorije) — bez ikakvog
// poređenja/računanja datuma, pa nema rizika od neuklapanja usled legacy
// razlika u tome kako su stari periodi izračunati.
export async function activateExistingSpecification(patientId, specId) {
  const spec = await Specification.findOne({ _id: specId, patientId });
  if (!spec) {
    const err = new Error("Specifikacija nije pronađena");
    err.status = 404;
    throw err;
  }
  return setActiveSpec(patientId, spec);
}

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


