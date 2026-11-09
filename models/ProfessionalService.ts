import mongoose, { type InferSchemaType } from "mongoose";

// Stručne usluge (npr. "Pregled specijaliste", "Psiholog — seansa"): naziv i cena u dinarima.
// Cenovnik pravi admin; uprava ih dodaje u specifikaciju (posle artikala).
const professionalServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    priceRSD: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

professionalServiceSchema.index({ name: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type ProfessionalServiceAttrs = InferSchemaType<typeof professionalServiceSchema>;
export default mongoose.model("ProfessionalService", professionalServiceSchema);
