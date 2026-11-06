import mongoose from "mongoose";

const combinationSchema = new mongoose.Schema({
    name: { type: String, required: true },
    analyses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true }],
    totalPrice: { type: Number }, // Ovdje će biti ukupna cena
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    group: { type: String, required: false, default: "Bez grupe" },
  }, { timestamps: true });

const Combination = mongoose.model("Combination", combinationSchema);
export default Combination;
