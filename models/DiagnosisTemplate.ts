import mongoose from "mongoose";

const DiagnosisTemplateSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required : true },
    createdBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, },
})

export default mongoose.model("DiagnosisTemplate", DiagnosisTemplateSchema)