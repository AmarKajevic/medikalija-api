import mongoose from "mongoose";

const PASSIVE_ROLES = [
  "Caregiver",
  "Physiotherapist",
  "Cleaner",
  "Kitchen",
  "Social Worker",
  "Janitor",
  "Occupational Therapist",
  "Administration"
];
const ACTIVE_ROLES = [
  "admin",
  "main-nurse",
  "nurse",
  "doctor",
];

const ALL_ROLES = [...ACTIVE_ROLES, ...PASSIVE_ROLES];

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
      default: function () {
        return ACTIVE_ROLES.includes(this.role);
      } 
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
export default User;
export { ACTIVE_ROLES, PASSIVE_ROLES, ALL_ROLES };
