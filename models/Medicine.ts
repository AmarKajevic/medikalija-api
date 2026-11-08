// models/Medicine.js
import mongoose from "mongoose";

// Vrsta leka: "oral" = tablete, kapsule (i ostalo što se pije); "parenteral" = ampule, rastvori, sol.
// U specifikaciji se vode kao posebne grupe (tablete pre ampula).
export const MEDICINE_FORMS = ["oral", "parenteral"] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];
export const isMedicineForm = (v: unknown): v is MedicineForm => MEDICINE_FORMS.includes(v as MedicineForm);

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    form: { type: String, enum: MEDICINE_FORMS, default: "oral" },
    pricePerUnit: { type: Number},

    quantity: { type: Number, required: true, default: 0 },



    unitsPerPackage: { type: Number, default: 0 },

    packageCount: { type: Number, default: 0 },


    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);


// Dodavanje/porodične zalihe traže lek po nazivu
medicineSchema.index({ name: 1 });

const Medicine = mongoose.model("Medicine", medicineSchema);
export default Medicine;
