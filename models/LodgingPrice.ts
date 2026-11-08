import mongoose, { type InferSchemaType } from "mongoose";

// Cenovnik smeštaja ("10 dana = 200 €", "30 dana = 900 €"...). Pravi ga admin;
// u obračunu specifikacije se bira cena za smeštaj za naredni period i vanstandardni period.
const lodgingPriceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** Broj dana (nije obavezan; služi za ređanje i opis) */
    days: { type: Number, default: null, min: 0 },
    priceEUR: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

lodgingPriceSchema.index({ name: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type LodgingPriceAttrs = InferSchemaType<typeof lodgingPriceSchema>;
export default mongoose.model("LodgingPrice", lodgingPriceSchema);
