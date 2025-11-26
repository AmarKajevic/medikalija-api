import mongoose from "mongoose";

const usedMedicineSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
    amount: { type: Number, required: true },
    fromFamily: { type: Boolean, default: false }, // ako je porodica donela lek
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    priceAtTheTime:{ type: Number, required: true },
  },
  { timestamps: true }
);

const UsedMedicine = mongoose.model("UsedMedicine", usedMedicineSchema)
export default UsedMedicine;