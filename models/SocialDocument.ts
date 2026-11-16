import mongoose, { type InferSchemaType } from "mongoose";

// Stručni dokumenti socijalnog radnika (Pravilnik o bližim uslovima i standardima za pružanje
// usluga socijalne zaštite), sa delovima TAČNO kao na obrascima doma:
//  intake        — obrazac 2, prijemna procena (čl. 12)
//  anamnesis     — obrazac 4, list o socijalno-anamnestičkim podacima
//  assessment    — obrazac 10, procena (čl. 13)
//  support_scale — obrazac 11, određivanje stepena potrebne podrške (čl. 14)
//  plan          — obrazac 12, individualni plan usluge (čl. 16)
//  plan_review   — obrazac 13, ponovni pregled (čl. 17)
//  reassessment  — raniji oblik ponovne procene (samo postojeći zapisi; nova = nova procena)
// Nacrt se menja; zaključen dokument je zapis i više se ne menja (nova procena = novi dokument).

export const DOC_TYPES = ["intake", "anamnesis", "assessment", "support_scale", "plan", "plan_review", "reassessment"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Delovi teksta po vrsti dokumenta (isti ključevi u aplikaciji i u Word obrascima) */
export const DOC_SECTIONS: Record<DocType, readonly string[]> = {
  intake: ["attitude", "eligibility", "priority", "abilities", "capacity"],
  anamnesis: ["mobility", "selfCare", "communication", "chronicIllness", "healthOther", "family", "familyOther", "requestedBy", "reasons", "userAttitude", "relativesAttitude", "circumstances", "commission"],
  assessment: ["needs", "priorityNeeds", "strengths", "risks", "abilities", "interests"],
  support_scale: ["duration", "otherProblems", "observations"],
  plan: ["otherProblems", "goals", "activities", "outcomes", "timeframe", "evaluationMethod", "responsible", "implementers"],
  plan_review: ["otherProblems", "selfCare", "communication", "social", "family", "satisfaction", "progress", "adjustments"],
  reassessment: ["changes", "socialHistory", "health", "selfCare", "mental", "socialTies", "risks", "needs", "userView", "conclusion"],
};

/** Delovi iz ranijeg oblika dokumenata — čuvaju se i prikazuju (samo za čitanje), ne gube se */
export const LEGACY_SECTIONS: Record<DocType, readonly string[]> = {
  intake: ["request", "userAttitude", "outcome", "alternatives"],
  anamnesis: [],
  assessment: ["socialHistory", "health", "selfCare", "mental", "communication", "socialTies", "culture", "userView", "conclusion", "needs", "strengths", "risks", "interests"],
  support_scale: [],
  plan: ["summary", "adaptation"],
  plan_review: ["changes", "conclusion"],
  reassessment: [],
};

const goalSchema = new mongoose.Schema(
  {
    /** Oblast (npr. Adaptacija, Socijalni kontakti, Ostvarivanje prava) */
    area: { type: String, trim: true, default: "", maxlength: 120 },
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
    /** Skala podrške (obrazac 11): ocena stanja na prijemu i očekivanog ishoda po stavci, 1–4 */
    scale: { type: Map, of: new mongoose.Schema({ now: { type: Number, default: null }, expected: { type: Number, default: null } }, { _id: false }), default: {} },
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
