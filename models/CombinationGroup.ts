import mongoose from "mongoose";

const combinationGroupSchema = new mongoose.Schema({
  name: { type: String, required: true }, // naziv grupe
  combinations: [
    {
      _id: { type: mongoose.Schema.Types.ObjectId, ref: "Combination", required: true },
      name: { type: String, required: true },
      totalPrice: Number,
      analyses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true, default: [] }],
    }
  ],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

const CombinationGroup = mongoose.model("CombinationGroup", combinationGroupSchema);
export default CombinationGroup;
