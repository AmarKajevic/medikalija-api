// models/Specification.js
import mongoose, { type HydratedDocumentFromSchema } from "mongoose";

const specificationSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Patient",
    required: true,
  },
  items: [
    {
      name: String,
      category: String,
       combination: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Combination",
        },
      medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine" },
      // Vrsta leka u trenutku dodavanja ("oral" tablete/kapsule, "parenteral" ampule/rastvori/sol)
      form: { type: String, default: undefined },
      article: { type: mongoose.Schema.Types.ObjectId, ref: "Article" },
      analyses: [
        {
          _id: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis" },
          name: String,
          price: Number,
        },
      ],
      price: Number,
      amount: Number,
      date: Date,
      // Pojedinačna dodavanja koja čine ovu stavku. Omogućavaju da se brisanjem
      // stavke vrati stanje na lager i obriše zapis o potrošnji. Stare stavke
      // (pre ovog polja) ga nemaju — njihovo brisanje samo uklanja trošak.
      entries: [
        {
          usedRecord: { type: mongoose.Schema.Types.ObjectId },
          homeAmount: { type: Number, default: 0 },
          familyAmount: { type: Number, default: 0 },
          price: { type: Number, default: 0 },
          createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          date: { type: Date, default: Date.now },
        },
      ],
    },
  ],
  totalPrice: { type: Number, default: 0 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  isActive: { type: Boolean, default: false, index: true },
  // Vanstandardni period: ručno izabrani datumi van redovnog niza perioda. Ne pomera
  // redovne periode i u njega se ništa ne raspoređuje automatski (samo ručno).
  nonStandard: { type: Boolean, default: false },

  // ❌ lodgingPrice više NE koristimo – uklonjeno
  // lodgingPrice: { type: Number, default: 0 },

  extraCosts: { type: Number, default: 0 },

  // ✅ NOVO – kompletan obračun naplate koji sada radiš na frontendu
  billing: {
    lowerExchangeRate: { type: Number, default: 0 },   // niži kurs
    middleExchangeRate: { type: Number, default: 0 },  // srednji kurs

    /** Da li se dug iz prethodnog perioda naplaćuje i štampa */
    includeDebt: { type: Boolean },
    previousDebtEUR: { type: Number, default: 0 },
    previousDebtRSD: { type: Number, default: 0 },

    /** Da li se smeštaj za naredni period naplaćuje i štampa */
    includeLodging: { type: Boolean },
    nextLodgingEUR: { type: Number, default: 0 },
    nextLodgingRSD: { type: Number, default: 0 },
    /** Izabrana cena iz cenovnika smeštaja (npr. "30 dana"); prazno = ručno unet iznos */
    nextLodgingOption: { type: String, default: "" },

    /** Vanstandardni period smeštaja (npr. dani pre početka perioda) — opciono, kao dug i smeštaj */
    includeEarlyLodging: { type: Boolean },
    earlyLodgingEUR: { type: Number, default: 0 },
    earlyLodgingRSD: { type: Number, default: 0 },
    earlyLodgingOption: { type: String, default: "" },
    /** Napomena uz vanstandardni smeštaj (iz liste koju pravi admin) — štampa se u istom redu */
    earlyLodgingNote: { type: String, default: "" },

    specEUR: { type: Number, default: 0 },             // specifikacija u evrima
    totalRSD: { type: Number, default: 0 },
    totalEUR: { type: Number, default: 0 },

    nextPeriodStart: { type: Date },
    nextPeriodEnd: { type: Date },
  },

  createdAt: { type: Date, default: Date.now },
},
// Svako čuvanje proverava verziju dokumenta — istovremene izmene iste
// specifikacije ne mogu tiho da prepišu jedna drugu (vidi mutateSpec).
{ optimisticConcurrency: true });

export type SpecificationDoc = HydratedDocumentFromSchema<typeof specificationSchema>;
export type SpecificationItem = SpecificationDoc["items"][number];

// Periodi pacijenta (lanac, istorija, raniji periodi) i aktivan period
specificationSchema.index({ patientId: 1, startDate: 1 });
specificationSchema.index({ patientId: 1, isActive: 1 });

const Specification = mongoose.model("Specification", specificationSchema);
export default Specification;
