// models/Medicine.js
import mongoose from "mongoose";

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pricePerUnit: { type: Number},

    quantity: { type: Number, required: true, default: 0 },



    unitsPerPackage: { type: Number, default: 0 },

    packageCount: { type: Number, default: 0 },


    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const Medicine = mongoose.model("Medicine", medicineSchema);
export default Medicine;
