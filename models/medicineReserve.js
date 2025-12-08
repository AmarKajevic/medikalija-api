import mongoose from "mongoose";

const medicineReserveSchema = new mongoose.Schema(
  {
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Medicine",
      required: true,
    },

    name: { type: String, required: true },

    amount: { type: Number, required: true },

    source: {
      type: String,
      enum: ["home", "family"],
      required: true,
    },

    pricePerUnit: { type: Number },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

const MedicineReserve = mongoose.model(
  "MedicineReserve",
  medicineReserveSchema
);

export default MedicineReserve;
