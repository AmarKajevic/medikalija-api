import mongoose from "mongoose";

const patientMedicineSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Medicine",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

// Jedan lek po pacijentu (nema duplikata)
patientMedicineSchema.index({ patient: 1, medicine: 1 }, { unique: true });

const PatientMedicine = mongoose.model(
  "PatientMedicine",
  patientMedicineSchema
);

export default PatientMedicine;
