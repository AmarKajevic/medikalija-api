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

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },

    role: {
      type: String,
      enum: ALL_ROLES,
      required: true,
    },

    // ❗ Ako false → mogu biti registrovani ali NE mogu se ulogovati
    loginAllowed: { 
      type: Boolean, 
      default: function (this: { role: string }) {
        return isActiveRole(this.role);
      },
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export type UserAttrs = InferSchemaType<typeof userSchema>;

const User = mongoose.model("User", userSchema);
export default User;
export { ACTIVE_ROLES, PASSIVE_ROLES, ALL_ROLES };
