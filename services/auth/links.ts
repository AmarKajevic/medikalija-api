// Jednokratni linkovi za pozivnicu i novu lozinku. U bazi je samo SHA-256 heš,
// pa curenje baze ne otkriva važeće linkove. Novi link poništava prethodni.
import crypto from "node:crypto";
import type { HydratedDocument } from "mongoose";
import User, { type UserAttrs } from "../../models/User.js";

export type LinkPurpose = "invite" | "reset";

export const LINK_HOURS: Record<LinkPurpose, number> = { invite: 7 * 24, reset: 24 };

export const hashToken = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

/** Adresa frontenda za linkove u mejlu (APP_URL ili prvi CORS origin) */
export const appUrl = () =>
  (process.env.APP_URL || (process.env.CORS_ORIGIN || "https://medikalija-frontend.vercel.app").split(",")[0]!.trim()).replace(/\/+$/, "");

export const linkUrl = (purpose: LinkPurpose, raw: string) => `${appUrl()}/${purpose === "invite" ? "invite" : "reset-password"}/${raw}`;

export async function issueLink(user: HydratedDocument<UserAttrs>, purpose: LinkPurpose, hours = LINK_HOURS[purpose]) {
  const raw = crypto.randomBytes(32).toString("base64url");
  user.set({ link: { tokenHash: hashToken(raw), purpose, expiresAt: new Date(Date.now() + hours * 3_600_000) } });
  await user.save();
  return { raw, url: linkUrl(purpose, raw), expiresAt: user.link!.expiresAt! };
}

export async function findByLink(raw: unknown) {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 100) return null;
  return User.findOne({ "link.tokenHash": hashToken(raw), "link.expiresAt": { $gt: new Date() } });
}
