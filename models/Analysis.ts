import mongoose from "mongoose";

const AnalysisSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    createdBy:{ type: mongoose.Schema.Types.ObjectId, ref:"User", required: true },
})

const Analysis = mongoose.model("Analysis", AnalysisSchema)
export default Analysis