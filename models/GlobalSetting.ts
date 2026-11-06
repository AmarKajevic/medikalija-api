import mongoose, { type InferSchemaType } from "mongoose";

// Podaci o ustanovi koja koristi aplikaciju: prikazuju se u meniju, na prijavi
// i u zaglavlju PDF specifikacije. Podrazumevane vrednosti čuvaju izgled
// postojeće instalacije dok ih administrator ne promeni.
export const DEFAULT_FACILITY = {
  name: "Medikalija",
  subtitle: "Dom za stara lica",
  address: "",
  city: "",
  taxId: "",
  registrationNumber: "",
  phone: "",
  email: "",
  website: "",
  bankAccount: "",
  logo: "",
} as const;

export type FacilityField = keyof typeof DEFAULT_FACILITY;
export const FACILITY_FIELDS = Object.keys(DEFAULT_FACILITY) as FacilityField[];

const facilitySchema = new mongoose.Schema(
  Object.fromEntries(FACILITY_FIELDS.map((f) => [f, { type: String, default: DEFAULT_FACILITY[f], trim: true }])),
  { _id: false }
);

const globalSettingSchema = new mongoose.Schema(
  {
    lowerExchangeRate: { type: Number, default: 0 },
    middleExchangeRate: { type: Number, default: 0 },
    facility: { type: facilitySchema, default: () => ({}) },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export type GlobalSettingAttrs = InferSchemaType<typeof globalSettingSchema>;

export default mongoose.model("GlobalSetting", globalSettingSchema);
