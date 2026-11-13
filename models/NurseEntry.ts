import mongoose, { type HydratedDocumentFromSchema, type InferSchemaType } from "mongoose";

// Unos medicinske sestre za pacijenta: dat lek, dat artikal ili urađena usluga nege.
// Fizioterapeut beleži fizikalnu terapiju ("physio"): redovna se samo beleži, vanredna
// čeka da uprava odredi cenu i odobri je (tada ulazi u specifikaciju).
// Ono što se naplaćuje čeka da ga uprava prihvati (tada ulazi u specifikaciju i
// skida se sa stanja) ili odbije. Usluge bez naplate se samo beleže.
export const ENTRY_TYPES = ["medicine", "article", "care", "physio"] as const;
export const PHYSIO_KINDS = ["active", "passive", "group"] as const;
export type PhysioKind = (typeof PHYSIO_KINDS)[number];
export type EntryType = (typeof ENTRY_TYPES)[number];

//  pending    čeka odobrenje
//  processing upravo se prihvata (zaključano da dva klika ne naplate dvaput)
//  accepted   ušlo u specifikaciju
//  rejected   odbijeno, ništa nije naplaćeno ni skinuto sa stanja
//  logged     usluga bez naplate, samo zabeležena
export const ENTRY_STATUSES = ["pending", "processing", "accepted", "rejected", "logged"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

const nurseEntrySchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    type: { type: String, enum: ENTRY_TYPES, required: true },
    medicine: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", default: null },
    article: { type: mongoose.Schema.Types.ObjectId, ref: "Article", default: null },
    careTask: { type: mongoose.Schema.Types.ObjectId, ref: "CareTask", default: null },
    /** Fizikalna terapija: vrsta i da li je vanredna (naplaćuje se) */
    // Osnovna vrsta ("active" | "passive" | "group") ili vrsta koju je dodao admin (vidi PhysioPrice)
    physioKind: { type: String, default: null },
    extra: { type: Boolean, default: false },
    /** Naziv u trenutku unosa (ostaje i ako se lek/usluga kasnije preimenuje ili obriše) */
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: "", maxlength: 500 },
    performedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    status: { type: String, enum: ENTRY_STATUSES, required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, trim: true, default: "", maxlength: 300 },
    /** Prihvaćena količina (uprava može da je ispravi) */
    acceptedAmount: { type: Number, default: null },
    /** Iznos koji je ušao u specifikaciju (RSD) */
    chargedPrice: { type: Number, default: 0 },
    specification: { type: mongoose.Schema.Types.ObjectId, ref: "Specification", default: null },
    /** Veze sa specifikacijom: brisanjem tih stavki unos se vraća na odobrenje */
    usedRecords: [{ type: mongoose.Schema.Types.ObjectId }],
    specItems: [{ type: mongoose.Schema.Types.ObjectId }],
  },
  { timestamps: true }
);

nurseEntrySchema.index({ patient: 1, status: 1, performedAt: -1 });
nurseEntrySchema.index({ status: 1, performedAt: -1 });
nurseEntrySchema.index({ createdBy: 1, performedAt: -1 });

export type NurseEntryAttrs = InferSchemaType<typeof nurseEntrySchema>;
export type NurseEntryDoc = HydratedDocumentFromSchema<typeof nurseEntrySchema>;

export default mongoose.model("NurseEntry", nurseEntrySchema);
