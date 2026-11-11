import mongoose, { type InferSchemaType } from "mongoose";

// Socijalni dosije korisnika: lični i pravni podaci koje unosi socijalni radnik i koji se
// ponavljaju u dokumentima (ugovor, procene, individualni plan, dopisi CSR-u).
// Jedan profil po pacijentu; ime, prezime, datum rođenja, adresa i prijem su u Patient.

export const SEX = ["", "M", "Ž"] as const;
export const MARITAL_STATUS = ["", "single", "married", "partnership", "divorced", "widowed"] as const;
export const LEGAL_CAPACITY = ["", "full", "partial", "none"] as const;
export const PLACEMENT_BASIS = ["", "contract", "csr"] as const;
export const PAYERS = ["", "resident", "family", "csr", "mixed", "other"] as const;
export const PENSION_TYPES = ["", "old_age", "family", "disability", "foreign", "none", "other"] as const;

const str = (max = 200) => ({ type: String, trim: true, default: "", maxlength: max });

const contactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 120 },
    relation: str(60),
    phone: str(60),
    email: str(120),
    address: str(200),
    /** Obaveštava se u hitnim slučajevima */
    emergency: { type: Boolean, default: false },
    note: str(300),
  },
  { _id: true }
);

const socialProfileSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true, unique: true },

    // Lični podaci
    jmbg: str(13),
    parentName: str(120),
    birthPlace: str(120),
    sex: { type: String, enum: SEX, default: "" },
    citizenship: str(60),
    nationality: str(60),
    language: str(60),
    religion: str(60),
    maritalStatus: { type: String, enum: MARITAL_STATUS, default: "" },
    education: str(120),
    occupation: str(120),
    idCardNumber: str(30),
    /** LBO / broj zdravstvene kartice */
    healthInsuranceNumber: str(30),
    chosenDoctor: str(120),
    municipality: str(120),

    // Prihodi i plaćanje smeštaja
    pensionType: { type: String, enum: PENSION_TYPES, default: "" },
    incomeNote: str(300),
    payer: { type: String, enum: PAYERS, default: "" },

    // Pravni status
    legalCapacity: { type: String, enum: LEGAL_CAPACITY, default: "" },
    guardian: {
      name: str(120),
      relation: str(60),
      phone: str(60),
      decisionNumber: str(60),
      decisionDate: { type: Date, default: null },
      authority: str(160),
    },
    /** Osoba od poverenja (čl. 10a Pravilnika o standardima) */
    trustedPerson: {
      name: str(120),
      relation: str(60),
      phone: str(60),
    },

    // Osnov smeštaja
    placementBasis: { type: String, enum: PLACEMENT_BASIS, default: "" },
    contractNumber: str(60),
    contractDate: { type: Date, default: null },
    csrName: str(160),
    caseManager: str(120),
    csrDecisionNumber: str(60),
    csrDecisionDate: { type: Date, default: null },

    contacts: { type: [contactSchema], default: [] },

    /** Stepen podrške I–IV (čl. 15); 0 = nije procenjen. Ažurira se iz zaključene procene. */
    supportLevel: { type: Number, min: 0, max: 4, default: 0 },
    /** Zaduženi zaposleni (čl. 10 st. 4) */
    assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Isti JMBG ne sme biti kod dva korisnika (prazan JMBG je dozvoljen više puta)
socialProfileSchema.index({ jmbg: 1 }, { unique: true, partialFilterExpression: { jmbg: { $gt: "" } } });

export type SocialProfileAttrs = InferSchemaType<typeof socialProfileSchema>;

export default mongoose.model("SocialProfile", socialProfileSchema);
