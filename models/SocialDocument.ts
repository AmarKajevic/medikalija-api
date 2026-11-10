import mongoose, { type InferSchemaType } from "mongoose";

// Stručni dokumenti socijalnog radnika (Pravilnik o bližim uslovima i standardima za pružanje
// usluga socijalne zaštite): prijemna procena (čl. 12), procena (čl. 13–15), individualni plan
// usluge (čl. 16), ponovni pregled plana (čl. 17) i ponovna procena.
// Nacrt se menja; zaključen dokument je zapis i više se ne menja (nova procena = novi dokument).

export const DOC_TYPES = ["intake", "assessment", "reassessment", "plan", "plan_review"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Delovi teksta po vrsti dokumenta (ključevi su isti u aplikaciji i u budućim šablonima) */
export const DOC_SECTIONS: Record<DocType, readonly string[]> = {
  intake: ["request", "userAttitude", "eligibility", "capacity", "priority", "alternatives", "outcome"],
  assessment: ["health", "selfCare", "mental", "communication", "socialTies", "interests", "strengths", "risks", "needs", "culture", "userView", "conclusion"],
  reassessment: ["changes", "health", "selfCare", "mental", "socialTies", "risks", "needs", "userView", "conclusion"],
  plan: ["summary", "adaptation"],
  plan_review: ["progress", "changes", "conclusion"],
};

const goalSchema = new mongoose.Schema(
  {
    goal: { type: String, trim: true, required: true, maxlength: 500 },
    outcome: { type: String, trim: true, default: "", maxlength: 500 },
    activities: { type: String, trim: true, default: "", maxlength: 2000 },
    responsible: { type: String, trim: true, default: "", maxlength: 200 },
    due: { type: Date, default: null },
    /** Ponovni pregled: ostvareno / delimično / nije */
    status: { type: String, enum: ["", "achieved", "partial", "not_achieved"], default: "" },
  },
  { _id: true }
);

const socialDocumentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    type: { type: String, enum: DOC_TYPES, required: true },
    date: { type: Date, required: true },
    status: { type: String, enum: ["draft", "final"], default: "draft" },
    sections: { type: Map, of: String, default: {} },
    /** Procene: stepen podrške I–IV (čl. 15); 0 = nije određen */
    supportLevel: { type: Number, min: 0, max: 4, default: 0 },
    /** Ko je učestvovao (korisnik, porodica, staratelj, voditelj slučaja, zaposleni...) */
    participants: { type: String, trim: true, default: "", maxlength: 1000 },
    /** Individualni plan: ciljevi, ishodi, aktivnosti, odgovorni, rok */
    goals: { type: [goalSchema], default: [] },
    /** Plan i pregled plana: rok za ponovni pregled (najviše 12 meseci za odrasle i starije) */
    nextReview: { type: Date, default: null },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    finalizedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

socialDocumentSchema.index({ patient: 1, date: -1 });
socialDocumentSchema.index({ status: 1, type: 1 });

export type SocialDocumentAttrs = InferSchemaType<typeof socialDocumentSchema>;

export default mongoose.model("SocialDocument", socialDocumentSchema);
