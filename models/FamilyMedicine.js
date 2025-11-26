// models/FamilyMedicine.js
import mongoose from "mongoose";

const familyMedicineSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // ✅ UKUPAN broj tableta / jedinica
    quantity: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    // ✅ koliko tableta ima JEDNO pakovanje (npr. 12)
    unitsPerPackage: {
      type: Number,
      default: null, // može da bude null ako ne znamo / nije bitno
      min: 1,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

const FamilyMedicine = mongoose.model("FamilyMedicine", familyMedicineSchema);
export default FamilyMedicine;
