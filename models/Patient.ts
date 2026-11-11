import mongoose from "mongoose";

const PatientSchema = new mongoose.Schema({
    name: { type: String, required: true },
    lastName: { type: String, required: true },
    // Obavezni su samo ime, prezime i datum prijema (od njega se računaju periodi); ostalo se
    // može dopuniti kasnije (npr. socijalni radnik unosi korisnika pre nego što ima sva dokumenta)
    dateOfBirth: { type: Date, default: null },
    address: { type: String, default: "" },
    admissionDate: { type: Date, required: true },
     contactPerson: {
    type: String,
    default: "",
    },
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
