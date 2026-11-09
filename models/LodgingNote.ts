import mongoose, { type InferSchemaType } from "mongoose";

// Napomene za vanstandardni period smeštaja (npr. "Smeštaj od dana prijema do početka perioda").
// Pravi ih admin uz cene smeštaja; u obračunu se bira napomena koja se štampa u redu smeštaja.
const lodgingNoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

lodgingNoteSchema.index({ text: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type LodgingNoteAttrs = InferSchemaType<typeof lodgingNoteSchema>;
export default mongoose.model("LodgingNote", lodgingNoteSchema);
