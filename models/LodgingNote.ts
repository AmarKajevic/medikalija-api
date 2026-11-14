import mongoose, { type InferSchemaType } from "mongoose";

// Šabloni za vanstandardni period smeštaja. Pravi ih admin uz cene smeštaja; bira ih uprava u obračunu.
//  note  — napomena koja se dopisuje u red smeštaja ("Smeštaj za period … – napomena")
//  title — naziv koji ide u specifikaciju TAČNO kako je napisan, umesto "Smeštaj za period …"
//          (npr. "Otkazni rok 15 dana — pacijent izlazi za 10 dana")
const lodgingNoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    kind: { type: String, enum: ["note", "title"], default: "note" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

lodgingNoteSchema.index({ text: 1 }, { unique: true, collation: { locale: "sr", strength: 2 } });

export type LodgingNoteAttrs = InferSchemaType<typeof lodgingNoteSchema>;
export default mongoose.model("LodgingNote", lodgingNoteSchema);
