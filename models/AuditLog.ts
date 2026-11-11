import mongoose, { type InferSchemaType } from "mongoose";

// Zapisnik izmena osetljivih podataka (lični podaci korisnika, socijalni dokumenti, trajna brisanja):
// ko je, kada i šta menjao. Čuvaju se nazivi polja, ne i vrednosti — zapisnik ne umnožava JMBG i slično.
const auditLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, maxlength: 60 },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fields: { type: [String], default: [] },
    summary: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ patient: 1, createdAt: -1 });

export type AuditLogAttrs = InferSchemaType<typeof auditLogSchema>;

export default mongoose.model("AuditLog", auditLogSchema);
