import mongoose, { type HydratedDocumentFromSchema, type InferSchemaType } from "mongoose";

// Lekarski izveštaj. Tok kao u zdravstvenim informacionim sistemima:
//  - nacrt (draft): menja ga samo autor, vidi ga samo autor
//  - potpisan (signed): zaključan, vidi ga zdravstveno osoblje; ispravka ide kao
//    dopuna (addendum) sa autorom i vremenom — dokumentacija se ne menja unazad
export const REPORT_TYPES = ["exam", "control", "admission", "specialist", "discharge", "other"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const vitalsSchema = new mongoose.Schema(
  {
    /** "130/85" */
    bloodPressure: { type: String, trim: true, default: "", maxlength: 15 },
    pulse: { type: Number, default: null, min: 0, max: 300 },
    temperature: { type: Number, default: null, min: 25, max: 45 },
    spo2: { type: Number, default: null, min: 0, max: 100 },
    glucose: { type: Number, default: null, min: 0, max: 60 },
    weight: { type: Number, default: null, min: 0, max: 400 },
  },
  { _id: false }
);

const diagnosisSchema = new mongoose.Schema(
  {
    /** MKB-10 šifra, npr. "I10" (nije obavezna) */
    code: { type: String, trim: true, uppercase: true, default: "", maxlength: 10 },
    name: { type: String, trim: true, required: true, maxlength: 200 },
  },
  { _id: false }
);

const addendumSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true, required: true, maxlength: 5000 },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const medicalReportSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: REPORT_TYPES, default: "exam" },
    visitDate: { type: Date, required: true },
    /** Pregled iz kalendara za koji je izveštaj pisan */
    appointment: {
      eventId: { type: mongoose.Schema.Types.ObjectId, ref: "CalendarEvent", default: null },
      occurrenceStart: { type: Date, default: null },
    },
    vitals: { type: vitalsSchema, default: () => ({}) },
    anamnesis: { type: String, trim: true, default: "", maxlength: 10000 },
    findings: { type: String, trim: true, default: "", maxlength: 10000 },
    diagnoses: { type: [diagnosisSchema], default: [] },
    therapy: { type: String, trim: true, default: "", maxlength: 10000 },
    conclusion: { type: String, trim: true, default: "", maxlength: 10000 },
    followUp: {
      date: { type: Date, default: null },
      note: { type: String, trim: true, default: "", maxlength: 500 },
    },
    status: { type: String, enum: ["draft", "signed"], default: "draft" },
    signedAt: { type: Date, default: null },
    addenda: { type: [addendumSchema], default: [] },
  },
  { timestamps: true }
);

medicalReportSchema.index({ patient: 1, visitDate: -1 });
medicalReportSchema.index({ author: 1, status: 1, updatedAt: -1 });
medicalReportSchema.index({ "appointment.eventId": 1, "appointment.occurrenceStart": 1 });

export type MedicalReportAttrs = InferSchemaType<typeof medicalReportSchema>;
export type MedicalReportDoc = HydratedDocumentFromSchema<typeof medicalReportSchema>;

export default mongoose.model("MedicalReport", medicalReportSchema);
