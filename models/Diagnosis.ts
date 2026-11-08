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

// Učinak rada pacijenta, najnoviji prvi
diagnosisSchema.index({ patient: 1, createdAt: -1 });

export default mongoose.model("Diagnosis", diagnosisSchema)