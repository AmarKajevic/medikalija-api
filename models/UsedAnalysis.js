import mongoose from "mongoose";

const usedAnalysisSchema = new mongoose.Schema({
  patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
  analysis: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true },
  priceAtTheTime: { type: Number, required: true }, // cena u momentu dodavanja
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, default: Date.now },
  combinationId: { type: mongoose.Schema.Types.ObjectId, ref: "Combination" }
  

}, { timestamps: true });

const UsedAnalysis = mongoose.model("UsedAnalysis", usedAnalysisSchema);
export default UsedAnalysis;