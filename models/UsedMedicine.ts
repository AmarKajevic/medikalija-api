import mongoose from "mongoose";

const usedMedicineSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
    amount: { type: Number, required: true },
    fromFamily: { type: Boolean, default: false }, // ako je porodica donela lek
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    priceAtTheTime:{ type: Number, required: true },
    // Koliko je uzeto sa porodičnog, a koliko sa kućnog (domskog) stanja
    familyAmount: { type: Number, default: 0 },
    homeAmount: { type: Number, default: 0 },
    roleUsed: { type: String },
  },
  { timestamps: true }
);

// Profil pacijenta: potrošnja, najnovija prva
usedMedicineSchema.index({ patient: 1, createdAt: -1 });

const UsedMedicine = mongoose.model("UsedMedicine", usedMedicineSchema)
export default UsedMedicine;