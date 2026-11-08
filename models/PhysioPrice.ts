import mongoose, { type InferSchemaType } from "mongoose";
import { PHYSIO_KINDS } from "./NurseEntry.js";

// Cenovnik vanredne fizikalne terapije (po vrsti terapije). Pravi ga admin unapred;
// kad uprava odobri vanrednu terapiju, cena se uzima odavde.
const physioPriceSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: PHYSIO_KINDS, required: true, unique: true },
    priceRSD: { type: Number, required: true, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export type PhysioPriceAttrs = InferSchemaType<typeof physioPriceSchema>;
export default mongoose.model("PhysioPrice", physioPriceSchema);
