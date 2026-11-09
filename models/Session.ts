import mongoose, { type HydratedDocumentFromSchema, type InferSchemaType } from "mongoose";

// Sesija = jedan prijavljen uređaj. Refresh token se rotira pri svakom osvežavanju, a sesija
// (i njen ID u access tokenu) ostaje ista — odjava uređaja gasi i njegov access token odmah.
// U bazi su samo heševi tokena: curenje baze ne daje preuzimanje sesija.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    /** SHA-256 važećeg refresh tokena */
    tokenHash: { type: String, required: true },
    /** Prethodni token: prihvata se još kratko posle rotacije (dva taba, izgubljen odgovor); kasnije je to krađa */
    prevTokenHash: { type: String, default: null },
    rotatedAt: { type: Date, default: null },
    method: { type: String, enum: ["password", "google"], required: true },
    userAgent: { type: String, default: "", maxlength: 300 },
    ip: { type: String, default: "" },
    lastUsedAt: { type: Date, default: Date.now },
    /** Neaktivnost: pomera se pri svakom osvežavanju; posle toga MongoDB briše zapis */
    expiresAt: { type: Date, required: true },
    /** Apsolutni rok: posle njega nova prijava, bez obzira na aktivnost */
    absoluteExpiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1 });

export type SessionAttrs = InferSchemaType<typeof sessionSchema>;
export type SessionDoc = HydratedDocumentFromSchema<typeof sessionSchema>;

export default mongoose.model("Session", sessionSchema);
