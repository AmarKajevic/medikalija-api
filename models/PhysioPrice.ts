import mongoose, { type InferSchemaType } from "mongoose";

// Cenovnik vanredne fizikalne terapije (po vrsti terapije). Pravi ga admin unapred;
// kad uprava odobri vanrednu terapiju (ili je doda u specifikaciju), cena se uzima odavde.
// Tri osnovne vrste ("active", "passive", "group") postoje od početka; admin dodaje nove
// (kind = "c" + id), a svaku može da preimenuje (`name`) ili obriše. Obrisana osnovna vrsta
// ostaje kao red sa `deleted: true` (inače bi se ponovo pojavila).
const physioPriceSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, unique: true, maxlength: 40 },
    /** Naziv (prazno kod osnovne vrste = ugrađen naziv) */
    name: { type: String, trim: true, default: "", maxlength: 160 },
    /** null = cena još nije uneta */
    priceRSD: { type: Number, default: null, min: 0 },
    /** Obrisana osnovna vrsta (dodate vrste se brišu iz baze) */
    deleted: { type: Boolean, default: false },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export type PhysioPriceAttrs = InferSchemaType<typeof physioPriceSchema>;
export default mongoose.model("PhysioPrice", physioPriceSchema);
