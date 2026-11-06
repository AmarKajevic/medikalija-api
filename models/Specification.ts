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

  // ❌ lodgingPrice više NE koristimo – uklonjeno
  // lodgingPrice: { type: Number, default: 0 },

  extraCosts: { type: Number, default: 0 },

  // ✅ NOVO – kompletan obračun naplate koji sada radiš na frontendu
  billing: {
    lowerExchangeRate: { type: Number, default: 0 },   // niži kurs
    middleExchangeRate: { type: Number, default: 0 },  // srednji kurs

    previousDebtEUR: { type: Number, default: 0 },
    previousDebtRSD: { type: Number, default: 0 },

    nextLodgingEUR: { type: Number, default: 0 },
    nextLodgingRSD: { type: Number, default: 0 },

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

const Specification = mongoose.model("Specification", specificationSchema);
export default Specification;
