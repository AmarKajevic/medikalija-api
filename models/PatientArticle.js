import mongoose from "mongoose";

const patientArticleSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },
    article: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Article",
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

// Jedan artikal po pacijentu (nema duplikata)
patientArticleSchema.index({ patient: 1, article: 1 }, { unique: true });

const PatientArticle = mongoose.model(
  "PatientArticle",
  patientArticleSchema
);

export default PatientArticle;
