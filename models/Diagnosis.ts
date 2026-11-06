import mongoose from "mongoose";

const diagnosisSchema = new mongoose.Schema({
    patient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Patient",
        required: true,
    },
    //public: { type: Boolean, default: true },
    description: {
        type: String,
        required: true,
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
        },
        
    },
    

  {timestamps: true}
);

export default mongoose.model("Diagnosis", diagnosisSchema)