import mongoose, { type InferSchemaType } from "mongoose";

// Katalog usluga nege ("Promenjene pelene", "Promenjena posteljina"...). Pravi ga
// uprava; sestre biraju iz liste šta je urađeno pacijentu.
//  - article + articleAmount: usluga troši artikal (naplaćuje se kao artikal, prvo porodično stanje)
//  - price: cena same usluge (naplaćuje se kao dodatni trošak)
//  - bez oba: usluga se samo beleži u negu pacijenta, bez odobrenja i naplate
const careTaskSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, trim: true, default: "Nega", maxlength: 60 },
    article: { type: mongoose.Schema.Types.ObjectId, ref: "Article", default: null },
    articleAmount: { type: Number, default: 1, min: 0 },
    price: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

careTaskSchema.index({ name: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type CareTaskAttrs = InferSchemaType<typeof careTaskSchema>;

/** Da li usluga nešto naplaćuje (pa ide na odobrenje) */
export const isBillableTask = (t: { article?: unknown; articleAmount?: number | null; price?: number | null }) =>
  (!!t.article && (t.articleAmount ?? 0) > 0) || (t.price ?? 0) > 0;

export default mongoose.model("CareTask", careTaskSchema);
