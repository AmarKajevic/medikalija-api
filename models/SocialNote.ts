import mongoose, { type InferSchemaType } from "mongoose";

// Beleška socijalnog radnika o pacijentu (socijalni karton). Podsetnik (followUp)
// služi za praćenje: "pozvati sina do petka", "predati zahtev CSR-u".
export const SOCIAL_CATEGORIES = ["resident", "family", "institution", "documents", "finance", "activity", "other"] as const;

const socialNoteSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, enum: SOCIAL_CATEGORIES, default: "other" },
    date: { type: Date, required: true },
    title: { type: String, trim: true, default: "", maxlength: 160 },
    text: { type: String, trim: true, required: true, maxlength: 10000 },
    /** S kim je razgovarano (npr. "sin Marko, 064...") */
    contact: { type: String, trim: true, default: "", maxlength: 200 },
    followUp: {
      date: { type: Date, default: null },
      done: { type: Boolean, default: false },
      doneAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

socialNoteSchema.index({ patient: 1, date: -1 });
socialNoteSchema.index({ "followUp.done": 1, "followUp.date": 1 });

export type SocialNoteAttrs = InferSchemaType<typeof socialNoteSchema>;

export default mongoose.model("SocialNote", socialNoteSchema);
