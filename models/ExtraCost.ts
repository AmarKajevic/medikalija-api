import mongoose, { type InferSchemaType } from "mongoose";

// Cenovnik drugih troškova (npr. "Frizer", "Prevoz", "Pedikir"): naziv i cena u dinarima.
// Cenovnik pravi admin; uprava bira trošak u specifikaciji ili ga unosi ručno.
const extraCostSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    priceRSD: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

extraCostSchema.index({ name: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type ExtraCostAttrs = InferSchemaType<typeof extraCostSchema>;
export default mongoose.model("ExtraCost", extraCostSchema);
