import mongoose, { type InferSchemaType } from "mongoose";

// Cenovnik vanredne fizikalne terapije (po vrsti terapije). Pravi ga admin unapred;
// kad uprava odobri vanrednu terapiju (ili je doda u specifikaciju), cena se uzima odavde.
// Tri osnovne vrste ("active", "passive", "group") postoje uvek; admin može da doda nove
// (kind = "c" + id, naziv u `name`).
const physioPriceSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, unique: true, maxlength: 40 },
    /** Naziv nove vrste (osnovne vrste imaju ugrađen naziv) */
    name: { type: String, trim: true, default: "", maxlength: 160 },
    priceRSD: { type: Number, required: true, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export type PhysioPriceAttrs = InferSchemaType<typeof physioPriceSchema>;
export default mongoose.model("PhysioPrice", physioPriceSchema);
