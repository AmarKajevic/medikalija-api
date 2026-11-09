// services/auth/sessions.ts
//
// Sesije i tokeni, po uzoru na velike SaaS servise:
//  - ACCESS token (JWT, 15 min) nosi korisnika (sub) i sesiju (sid); šalje se u Authorization
//    zaglavlju i drži se samo u memoriji browsera. Svaki zahtev proverava da sesija još postoji,
//    pa odjava uređaja / suspendovanje / nova lozinka važe odmah, ne tek kad token istekne.
//  - REFRESH token je nasumičan (nije JWT): "<sid>.<32 nasumična bajta>", u httpOnly kolačiću
//    ograničenom na /api/auth. U bazi je samo SHA-256 heš.
//  - Rotacija pri svakom osvežavanju. Prethodni token važi dok novi nije upotrebljen (izgubljen odgovor,
//    reload usred osvežavanja, dva taba) — tada se samo izda nov. Token koji je već zamenjen pa
//    upotrebljen (i stari i novi su u opticaju) znači krađu → gasi se cela sesija.
//  - Neaktivnost 7 dana i apsolutni rok 30 dana (posle toga nova prijava).
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import type { Request } from "express";
import Session, { type SessionDoc } from "../../models/Session.js";
import { hashToken } from "./links.js";
import { requireSecret } from "../../utils/env.js";
import { securityEvent } from "../../utils/logger.js";

type Id = Types.ObjectId | string;

export const ACCESS_TTL_SECONDS = 15 * 60;
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;
/** Koliko zamenjenih heševa sesija pamti (za otkrivanje krađe) */
const MAX_RETIRED = 50;
const ISSUER = "medikalija-api";
const AUDIENCE = "medikalija-app";

// ------------------ ACCESS TOKEN ------------------
export function signAccessToken(userId: Id, sessionId: Id): string {
  return jwt.sign({ sid: String(sessionId) }, requireSecret("JWT_KEY"), {
    subject: String(userId),
    expiresIn: ACCESS_TTL_SECONDS,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
  });
}

export class AccessTokenError extends Error {
  readonly code: "token_expired" | "token_invalid";
  constructor(code: "token_expired" | "token_invalid") {
    super(code);
    this.code = code;
  }
}

/** Proverava potpis, algoritam, izdavaoca, primaoca i rok; vraća korisnika i sesiju */
export function verifyAccessToken(token: string): { userId: string; sessionId: string } {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, requireSecret("JWT_KEY"), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE });
  } catch (err) {
    throw new AccessTokenError(err instanceof jwt.TokenExpiredError ? "token_expired" : "token_invalid");
  }
  if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.sid !== "string") {
    throw new AccessTokenError("token_invalid");
  }
  return { userId: payload.sub, sessionId: payload.sid };
}

// ------------------ REFRESH TOKEN / SESIJA ------------------
const newSecret = () => crypto.randomBytes(32).toString("base64url");
const formatToken = (sessionId: Id, secret: string) => `${String(sessionId)}.${secret}`;

function parseToken(raw: unknown): { sessionId: string; secret: string } | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [sessionId, secret] = parts as [string, string];
  if (!Types.ObjectId.isValid(sessionId) || secret.length < 40) return null;
  return { sessionId, secret };
}

const sameHash = (a: string, b: string | null | undefined) =>
  !!b && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const clientInfo = (req: Request) => ({
  userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
  ip: req.ip ?? "",
});

export async function createSession(userId: Id, method: "password" | "google", req: Request) {
  const secret = newSecret();
  const now = Date.now();
  const session = await Session.create({
    user: userId,
    tokenHash: hashToken(secret),
    method,
    ...clientInfo(req),
    lastUsedAt: new Date(now),
    expiresAt: new Date(now + SESSION_IDLE_MS),
    absoluteExpiresAt: new Date(now + SESSION_ABSOLUTE_MS),
  });
  return { session, refreshToken: formatToken(session._id, secret) };
}

export type RotateResult =
  | { ok: true; session: SessionDoc; refreshToken: string }
  | { ok: false; reason: "invalid" | "expired" | "reused" };

/** Zamenjuje refresh token novim (ista sesija). Ponovna upotreba starog posle kratkog roka gasi sesiju. */
export async function rotateSession(raw: unknown, req: Request, attempt = 0): Promise<RotateResult> {
  const parsed = parseToken(raw);
  if (!parsed) return { ok: false, reason: "invalid" };
  const session = await Session.findById(parsed.sessionId);
  if (!session) return { ok: false, reason: "invalid" };

  const now = new Date();
  if (session.expiresAt <= now || session.absoluteExpiresAt <= now) {
    await Session.deleteOne({ _id: session._id });
    return { ok: false, reason: "expired" };
  }

  const hash = hashToken(parsed.secret);
  const isCurrent = sameHash(hash, session.tokenHash);
  const isPrevious = !isCurrent && sameHash(hash, session.prevTokenHash);
  if (!isCurrent && !isPrevious) {
    // Zamenjen token u opticaju: neko ga je sačuvao (krađa) — gasi se sesija i za napadača i za korisnika
    if (session.retiredHashes.some((h) => sameHash(hash, h))) {
      await Session.deleteOne({ _id: session._id });
      securityEvent("refresh_token_reuse", { userId: String(session.user), sessionId: String(session._id), ip: req.ip });
      return { ok: false, reason: "reused" };
    }
    // Netačan token uz tuđ ID sesije ne gasi sesiju (ID nije tajna — inače bi to bio način da se neko odjavi)
    return { ok: false, reason: "invalid" };
  }

  // Važeći token: on postaje prethodni. Prethodni (klijent nije dobio novi): izdaje se nov,
  // a neupotrebljeni važeći se povlači (ako ga ipak neko pokaže, to je krađa).
  const retire = isCurrent ? session.prevTokenHash : session.tokenHash;
  const retired = [...session.retiredHashes, ...(retire ? [retire] : [])].slice(-MAX_RETIRED);
  const secret = newSecret();
  const idleEnd = Math.min(now.getTime() + SESSION_IDLE_MS, session.absoluteExpiresAt.getTime());
  // Uslov na heš koji smo videli: dva istovremena osvežavanja ne rotiraju dvaput od istog stanja
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, tokenHash: session.tokenHash },
    {
      $set: {
        tokenHash: hashToken(secret),
        prevTokenHash: isCurrent ? session.tokenHash : session.prevTokenHash,
        retiredHashes: retired,
        rotatedAt: now,
        lastUsedAt: now,
        expiresAt: new Date(idleEnd),
        ...clientInfo(req),
      },
    },
    { new: true }
  );
  if (!updated) return attempt < 2 ? rotateSession(raw, req, attempt + 1) : { ok: false, reason: "invalid" };
  return { ok: true, session: updated, refreshToken: formatToken(updated._id, secret) };
}

/** Da li sesija iz access tokena još postoji (odjava, nova lozinka i suspendovanje je brišu) */
export async function isSessionActive(sessionId: string, userId: Id): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;
  return !!(await Session.exists({ _id: sessionId, user: userId, expiresAt: { $gt: new Date() }, absoluteExpiresAt: { $gt: new Date() } }));
}

/** Sesija iz refresh tokena (za odjavu) — bez provere tajne ne briše ništa */
export async function revokeByRefreshToken(raw: unknown): Promise<void> {
  const parsed = parseToken(raw);
  if (!parsed) return;
  const session = await Session.findById(parsed.sessionId);
  const hash = hashToken(parsed.secret);
  if (session && (sameHash(hash, session.tokenHash) || sameHash(hash, session.prevTokenHash))) await Session.deleteOne({ _id: session._id });
}

/** Gasi sve sesije korisnika (suspendovanje, nova lozinka), osim eventualno trenutne */
export async function revokeSessions(userId: Id, exceptSessionId?: string): Promise<number> {
  const filter = exceptSessionId && Types.ObjectId.isValid(exceptSessionId) ? { user: userId, _id: { $ne: exceptSessionId } } : { user: userId };
  return (await Session.deleteMany(filter)).deletedCount;
}

export async function revokeSession(userId: Id, sessionId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;
  return (await Session.deleteOne({ _id: sessionId, user: userId })).deletedCount > 0;
}

/** Aktivni uređaji korisnika, najskorije korišćen prvi */
export async function listSessions(userId: Id) {
  const sessions = await Session.find({ user: userId, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).lean();
  return sessions.map((s) => ({
    id: String(s._id),
    method: s.method,
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.absoluteExpiresAt < s.expiresAt ? s.absoluteExpiresAt : s.expiresAt,
  }));
}
