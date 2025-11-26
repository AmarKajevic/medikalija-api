import mongoose from "mongoose";

const PatientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    lastName: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    address: { type: String, required: true },
    admissionDate: { type: Date, required: true },
    dischargeDate: {
        type: Date,
        default: null
        },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },


},
{
    timestamps: true,
});

const Patient = mongoose.model("Patient", PatientSchema);
export default Patient;
