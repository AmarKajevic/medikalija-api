import mongoose, { mongo } from "mongoose";

const DiagnosisTemplateSchema = mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required : true },
    createdBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, },
})

export default mongoose.model("DiagnosisTemplate", DiagnosisTemplateSchema)