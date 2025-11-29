// models/Specification.js
import mongoose from "mongoose";

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
    },
  ],
  totalPrice: { type: Number, default: 0 },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },

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
});

const Specification = mongoose.model("Specification", specificationSchema);
export default Specification;
