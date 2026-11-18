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
/** Ko podnosi zahtev i potpisuje izjave/ugovor: sam korisnik ili srodnik / staratelj / drugo lice */
export const APPLICANT_KINDS = ["", "self", "relative", "guardian", "other"] as const;
/** Obveznik ugovora: "" = isti kao podnosilac zahteva, "other" = drugo lice, "none" = nema (korisnik sam) */
export const OBLIGOR_SOURCES = ["", "other", "none"] as const;
/** Ugovor čl. 2: kategorija sobe */
export const ROOM_TYPES = ["", "single", "double", "any"] as const;
/** Ugovor čl. 3: kategorije korisnika (1–10) */
export const USER_CATEGORIES = 10;
/** Odluka o prestanku smeštaja: osnov 1–7 (redom kao u obrascu) */
export const DISCHARGE_REASONS = 7;

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
    /** Prezime pre zaključenja braka (devojačko) */
    maidenName: str(80),
    /** Prezime i ime oca / majke i njeno devojačko prezime (obrasci 4 i 4.1) */
    fatherName: str(120),
    motherName: str(120),
    motherMaidenName: str(80),
    /** Bračni drug: ime i prezime, devojačko prezime, adresa */
    spouse: { name: str(120), maidenName: str(80), address: str(200) },
    /** Kontakt korisnika (ugovor) */
    phone: str(60),
    email: str(120),
    messenger: str(60),
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
    /** Broj dosijea (npr. SR-2026/087) — kako ga vodi ustanova */
    dossierNumber: str(40),
    /** Smeštaj u domu: odeljenje i soba (npr. "Odeljenje B, soba 214") */
    accommodation: str(120),

    // Prihodi i plaćanje smeštaja
    pensionType: { type: String, enum: PENSION_TYPES, default: "" },
    incomeNote: str(300),
    payer: { type: String, enum: PAYERS, default: "" },
    /** Kako tačno piše u zahtevu: "Trošak smeštaja plaća svojom penzijom + sin" */
    payerNote: str(200),
    socialStatus: str(160),
    /** Zdravstveno osiguranje — osnov (npr. penzioner) */
    insuranceBasis: str(160),
    /** Podaci o imovini koju poseduje */
    property: str(500),
    /** Bolest zbog koje je potreban smeštaj ("Boluje od …" u izjavi srodnika) */
    diagnosis: str(300),

    // Postupak prijema: zahtev, podnosilac (on potpisuje izjave i ugovor kao obveznik)
    requestDate: { type: Date, default: null },
    applicant: {
      kind: { type: String, enum: APPLICANT_KINDS, default: "" },
      name: str(120),
      relation: str(60),
      sex: { type: String, enum: SEX, default: "" },
      address: str(200),
      jmbg: str(13),
      idCardNumber: str(30),
      email: str(120),
      phone: str(60),
      messenger: str(60),
    },
    /** Obveznik ugovora (srodnik ili drugo lice koje potpisuje ugovor i plaća smeštaj) */
    obligor: {
      source: { type: String, enum: OBLIGOR_SOURCES, default: "" },
      name: str(120),
      relation: str(60),
      address: str(200),
      jmbg: str(13),
      idCardNumber: str(30),
      email: str(120),
      phone: str(60),
      messenger: str(60),
    },
    /** Poverenik (ugovor čl. 11) */
    trustee: { name: str(120), address: str(200), idCardNumber: str(30), phone: str(60) },
    /** Ugovor o smeštaju */
    contract: {
      roomType: { type: String, enum: ROOM_TYPES, default: "" },
      categories: { type: [Number], default: [] },
      priceEUR: { type: Number, default: null, min: 0 },
      /** Tekući račun korisnika (ovlašćenje uz ugovor) */
      bankAccount: str(60),
    },
    /** Odluka o prestanku smeštaja: izabrani osnov 1–7; 0 = nije izabran */
    dischargeReason: { type: Number, min: 0, max: DISCHARGE_REASONS, default: 0 },

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
