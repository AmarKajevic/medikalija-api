import mongoose, { type InferSchemaType } from "mongoose";

const PASSIVE_ROLES = [
  "Caregiver",
  "Physiotherapist",
  "Cleaner",
  "Kitchen",
  "Social Worker",
  "Janitor",
  "Occupational Therapist",
  "Administration"
] as const;
const ACTIVE_ROLES = [
  "admin",
  "main-nurse",
  "nurse",
  "doctor",
  "social-worker",
] as const;

const ALL_ROLES = [...ACTIVE_ROLES, ...PASSIVE_ROLES];

export type ActiveRole = (typeof ACTIVE_ROLES)[number];
export type Role = (typeof ALL_ROLES)[number];
export const isActiveRole = (role: unknown): role is ActiveRole => ACTIVE_ROLES.includes(role as ActiveRole);

// Pristup samo po pozivu:
//  invited   pozvan, još nije postavio lozinku niti se prijavio Google-om
//  active    može da se prijavi
//  suspended pristup ukinut (sesije se gase odmah; istorija unosa ostaje)
// Stari zapisi nemaju status — tretiraju se kao aktivni (vidi canSignIn).
export const USER_STATUSES = ["invited", "active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

// Jedinstveno samo kad postoji (osoblje bez mejla / bez korisničkog imena je u redu)
const uniqueWhenSet = (field: string) => [{ [field]: 1 }, { unique: true, partialFilterExpression: { [field]: { $type: "string" } } }] as const;

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    /** Prijava i pozivnice; nije obavezan (sestra bez mejla dobija korisničko ime) */
    email: { type: String, trim: true, lowercase: true },
    /** Za osoblje bez mejla, npr. "sanja.p" */
    username: { type: String, trim: true, lowercase: true },
    /** Nema ga dok pozvani ne postavi lozinku (ili ako se prijavljuje samo Google-om) */
    passwordHash: { type: String, default: null },
    googleId: { type: String },

    role: {
      type: String,
      enum: ALL_ROLES,
      required: true,
    },

    // Uloge bez pristupa (kuhinja, higijena...) se vode u evidenciji, bez prijave
    loginAllowed: {
      type: Boolean,
      default: function (this: { role: string }) {
        return isActiveRole(this.role);
      },
    },
    status: { type: String, enum: USER_STATUSES, default: "active" },

    /** Jednokratni link: pozivnica ili nova lozinka (čuva se samo heš) */
    link: {
      tokenHash: { type: String, default: null },
      purpose: { type: String, enum: ["invite", "reset", null], default: null },
      expiresAt: { type: Date, default: null },
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    invitedAt: { type: Date, default: null },

    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginMethod: { type: String, enum: ["password", "google", null], default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index(...uniqueWhenSet("email"));
userSchema.index(...uniqueWhenSet("username"));
userSchema.index(...uniqueWhenSet("googleId"));
userSchema.index({ "link.tokenHash": 1 }, { partialFilterExpression: { "link.tokenHash": { $type: "string" } } });

// Tajne nikad ne izlaze iz API-ja; umesto njih se vidi šta korisnik ima podešeno
userSchema.set("toJSON", {
  transform: (_doc, ret: Record<string, unknown>) => {
    const link = ret.link as { purpose?: string | null; expiresAt?: Date | null } | undefined;
    ret.hasPassword = !!ret.passwordHash;
    ret.hasGoogle = !!ret.googleId;
    ret.status = ret.status ?? (ret.loginAllowed === false ? "suspended" : "active");
    ret.pendingLink = link?.purpose ? { purpose: link.purpose, expiresAt: link.expiresAt } : null;
    delete ret.passwordHash;
    delete ret.googleId;
    delete ret.link;
    delete ret.failedLogins;
    delete ret.lockedUntil;
    delete ret.__v;
    return ret;
  },
});

export type UserAttrs = InferSchemaType<typeof userSchema>;

/** Sme li korisnik da koristi aplikaciju (proverava se pri prijavi, osvežavanju sesije i svakom zahtevu) */
export function canSignIn(user: { role: string; loginAllowed?: boolean | null; status?: string | null }): boolean {
  return isActiveRole(user.role) && user.loginAllowed !== false && (user.status ?? "active") === "active";
}

const User = mongoose.model("User", userSchema);
export default User;
export { ACTIVE_ROLES, PASSIVE_ROLES, ALL_ROLES };
