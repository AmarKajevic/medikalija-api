import bcrypt from "bcrypt";
import type { CookieOptions, Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import User, { canSignIn, isActiveRole, type UserAttrs } from "../models/User.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { isMailEnabled, linkEmail, sendMail } from "../utils/mailer.js";
import { findByLink, issueLink } from "../services/auth/links.js";
import {
  createSession,
  listSessions,
  revokeByRefreshToken,
  revokeSession,
  revokeSessions,
  rotateSession,
  signAccessToken,
  SESSION_IDLE_MS,
} from "../services/auth/sessions.js";
import { log, securityEvent } from "../utils/logger.js";
import { assertStrongPassword } from "../services/auth/password.js";
import { googleClientId, verifyGoogleCredential } from "../services/auth/google.js";
import GlobalSetting from "../models/GlobalSetting.js";

type UserDoc = HydratedDocument<UserAttrs>;

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

// ------------------ SESIJE ------------------
// Refresh token je u httpOnly kolačiću ograničenom na /api/auth (ne šalje se uz ostale zahteve).
// U produkciji: Secure + prefiks __Secure- (browser ga ne prima preko http-a niti od poddomena).
const secureCookies = () => process.env.NODE_ENV === "production";
export const refreshCookieName = () => (secureCookies() ? "__Secure-rt" : "rt");
/** Kolačić iz ranije verzije (putanja "/", JWT refresh token) — samo se briše */
const LEGACY_COOKIE = "refreshToken";

const cookieBase = (): CookieOptions => ({
  httpOnly: true,
  secure: secureCookies(),
  // Frontend i API mogu biti na različitim sajtovima (*.vercel.app); preko /api rewrite-a su isti sajt
  sameSite: secureCookies() ? "none" : "lax",
  path: "/api/auth",
});

const setRefreshCookie = (res: Response, token: string) => res.cookie(refreshCookieName(), token, { ...cookieBase(), maxAge: SESSION_IDLE_MS });
const clearRefreshCookie = (res: Response) => res.clearCookie(refreshCookieName(), cookieBase());
const clearLegacyCookie = (req: Request, res: Response) => {
  if (req.cookies?.[LEGACY_COOKIE]) res.clearCookie(LEGACY_COOKIE, { ...cookieBase(), path: "/" });
};
const readRefreshCookie = (req: Request): unknown => req.cookies?.[refreshCookieName()];

export { revokeSessions };

const publicUser = (u: UserDoc) => ({ _id: u._id, name: u.name, lastName: u.lastName, role: u.role, email: u.email ?? null, username: u.username ?? null });

async function startSession(req: Request, res: Response, user: UserDoc, method: "password" | "google") {
  user.set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginMethod: method });
  await user.save();
  const { session, refreshToken } = await createSession(user._id, method, req);
  clearLegacyCookie(req, res);
  setRefreshCookie(res, refreshToken);
  log.info("login", { userId: String(user._id), sessionId: String(session._id), method, ip: req.ip });
  return res.status(200).json({ success: true, accessToken: signAccessToken(user._id, session._id), user: publicUser(user) });
}

/** Razlog zašto aktivan zapis ipak ne sme da se prijavi (ista poruka za sve ostalo) */
function accessProblem(user: UserDoc): string | null {
  if (canSignIn(user)) return null;
  if (!isActiveRole(user.role) || user.loginAllowed === false) return "Vaša uloga nema pristup aplikaciji.";
  if (user.status === "invited") return "Nalog još nije aktiviran. Otvorite link iz pozivnice.";
  return "Pristup je ukinut. Obratite se upravi doma.";
}

// ------------------ PRIJAVA LOZINKOM ------------------
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const INVALID = "Pogrešni podaci za prijavu.";
// Lažno poređenje kad korisnik ne postoji — odgovor traje isto (ne otkriva ko postoji)
const DUMMY_HASH = bcrypt.hashSync("nema-korisnika-dummy", 12);
/** Cena bcrypt heša za nove lozinke (stare sa 10 ostaju važeće) */
export const BCRYPT_COST = 12;

async function findForLogin(body: Record<string, unknown>): Promise<UserDoc | null> {
  const identifier = typeof body.identifier === "string" ? body.identifier.trim().toLowerCase() : "";
  if (identifier) {
    return identifier.includes("@") ? User.findOne({ email: identifier }) : User.findOne({ username: identifier });
  }
  // Prelazni period: stari način (ime + prezime) radi samo kad je osoba jedinstvena
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!name || !lastName) return null;
  const matches = await User.find({
    name: { $regex: new RegExp(`^${escapeRegex(name)}$`, "i") },
    lastName: { $regex: new RegExp(`^${escapeRegex(lastName)}$`, "i") },
  }).limit(2);
  return matches.length === 1 ? matches[0]! : null;
}

// POST /api/auth/login  { identifier: email|korisničko ime, password }  (prelazno: { name, lastName, password })
const login = async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const password = typeof body.password === "string" ? body.password : "";
    if (!password || (!body.identifier && !(body.name && body.lastName))) throw httpError(400, "Unesite e-mail ili korisničko ime i lozinku.");

    const user = await findForLogin(body);
    if (!user || !user.passwordHash) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw httpError(401, INVALID);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw httpError(429, `Previše neuspešnih pokušaja. Pokušajte ponovo za ${minutes} min.`);
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const failed = (user.failedLogins ?? 0) + 1;
      await User.updateOne(
        { _id: user._id },
        failed >= MAX_FAILED ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } } : { $set: { failedLogins: failed } }
      );
      if (failed >= MAX_FAILED) securityEvent("account_locked", { userId: String(user._id), ip: req.ip });
      throw httpError(401, failed >= MAX_FAILED ? `Previše neuspešnih pokušaja. Nalog je zaključan ${LOCK_MINUTES} minuta.` : INVALID);
    }
    const problem = accessProblem(user);
    if (problem) throw httpError(403, problem);
    return startSession(req, res, user, "password");
  } catch (err) {
    fail(res, err);
  }
};

// ------------------ PRIJAVA PREKO GOOGLE-A ------------------
// POST /api/auth/google  { credential, inviteToken? }
// Pristup samo po pozivu: Google nalog mora odgovarati pozvanom/postojećem korisniku.
const googleLogin = async (req: Request, res: Response) => {
  try {
    const identity = await verifyGoogleCredential(req.body?.credential);
    let user: UserDoc | null = null;

    if (req.body?.inviteToken) {
      user = await findByLink(req.body.inviteToken);
      if (!user || user.link?.purpose !== "invite") throw httpError(410, "Pozivnica je istekla ili je već iskorišćena.");
      if (user.email && identity.email !== user.email) throw httpError(403, `Pozivnica je za ${user.email}. Prijavite se tim Google nalogom.`);
    } else {
      user = await User.findOne({ googleId: identity.sub });
      if (!user && identity.email && identity.emailVerified) user = await User.findOne({ email: identity.email });
      if (!user) throw httpError(403, "Ovaj Google nalog nema pristup. Pristup se dobija pozivnicom uprave doma.");
    }
    if (user.googleId && user.googleId !== identity.sub) throw httpError(403, "Nalog je povezan sa drugim Google nalogom.");

    // Prva prijava pozvanog korisnika Google-om je prihvatanje pozivnice
    if (user.status === "invited") user.set({ status: "active", link: { tokenHash: null, purpose: null, expiresAt: null } });
    user.set({ googleId: identity.sub, email: user.email ?? identity.email ?? undefined });

    const problem = accessProblem(user);
    if (problem) throw httpError(403, problem);
    return startSession(req, res, user, "google");
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return res.status(409).json({ success: false, message: "Ova Google adresa je već povezana sa drugim korisnikom." });
    fail(res, err);
  }
};

// ------------------ OSVEŽAVANJE I ODJAVA ------------------
// POST /api/auth/refresh — nov access token i rotiran refresh token (ista sesija)
const refresh = async (req: Request, res: Response) => {
  try {
    clearLegacyCookie(req, res);
    const raw = readRefreshCookie(req);
    if (!raw) return res.status(401).json({ success: false, code: "no_session", message: "Niste prijavljeni." });

    const result = await rotateSession(raw, req);
    if (!result.ok) {
      clearRefreshCookie(res);
      const message = result.reason === "expired" ? "Sesija je istekla. Prijavite se ponovo." : "Sesija nije važeća. Prijavite se ponovo.";
      return res.status(401).json({ success: false, code: `session_${result.reason}`, message });
    }

    const user = await User.findById(result.session.user);
    // Suspendovan ili obrisan korisnik ne dobija novu sesiju
    if (!user || !canSignIn(user)) {
      await revokeSessions(result.session.user);
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, code: "access_revoked", message: "Pristup je ukinut." });
    }

    setRefreshCookie(res, result.refreshToken);
    return res.status(200).json({ success: true, accessToken: signAccessToken(user._id, result.session._id), user: publicUser(user) });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/logout — gasi ovu sesiju (i njen access token, odmah)
const logout = async (req: Request, res: Response) => {
  try {
    await revokeByRefreshToken(readRefreshCookie(req));
    clearRefreshCookie(res);
    clearLegacyCookie(req, res);
    return res.status(200).json({ success: true, message: "Odjavljeni ste." });
  } catch (err) {
    fail(res, err);
  }
};

// ------------------ AKTIVNI UREĐAJI ------------------
// GET /api/auth/sessions — moje sesije (uređaji), trenutna označena
const mySessions = async (req: Request, res: Response) => {
  try {
    const sessions = await listSessions(req.user._id);
    res.json({ success: true, sessions: sessions.map((s) => ({ ...s, current: s.id === req.sessionId })) });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/auth/sessions/:id — odjava jednog uređaja
const endSession = async (req: Request, res: Response) => {
  try {
    if (!(await revokeSession(req.user._id, String(req.params.id)))) throw httpError(404, "Sesija ne postoji.");
    res.json({ success: true, message: "Uređaj je odjavljen." });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/sessions/revoke-others — odjava sa svih ostalih uređaja
const endOtherSessions = async (req: Request, res: Response) => {
  try {
    const count = await revokeSessions(req.user._id, req.sessionId);
    res.json({ success: true, message: count ? `Odjavljeno uređaja: ${count}.` : "Nema drugih prijavljenih uređaja.", count });
  } catch (err) {
    fail(res, err);
  }
};

// ------------------ POZIVNICA I NOVA LOZINKA (javno, preko linka) ------------------
// GET /api/auth/link/:token — šta link otvara (za stranicu prihvatanja)
const getLink = async (req: Request, res: Response) => {
  try {
    const user = await findByLink(req.params.token);
    if (!user) throw httpError(410, "Link je istekao ili je već iskorišćen. Zatražite novi od uprave doma.");
    const inviter = user.invitedBy ? await User.findById(user.invitedBy, { name: 1, lastName: 1 }) : null;
    res.json({
      success: true,
      link: {
        purpose: user.link!.purpose,
        expiresAt: user.link!.expiresAt,
        name: user.name,
        lastName: user.lastName,
        email: user.email ?? null,
        username: user.username ?? null,
        role: user.role,
        invitedBy: inviter ? `${inviter.name} ${inviter.lastName}` : null,
        google: !!googleClientId(),
      },
    });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/link/:token  { password } — postavlja lozinku i prijavljuje
const acceptLink = async (req: Request, res: Response) => {
  try {
    const user = await findByLink(req.params.token);
    if (!user) throw httpError(410, "Link je istekao ili je već iskorišćen. Zatražite novi od uprave doma.");
    assertStrongPassword(req.body?.password, user);
    const purpose = user.link!.purpose;
    user.set({
      passwordHash: await bcrypt.hash(req.body.password, BCRYPT_COST),
      passwordChangedAt: new Date(),
      status: user.status === "suspended" ? "suspended" : "active",
      link: { tokenHash: null, purpose: null, expiresAt: null },
      failedLogins: 0,
      lockedUntil: null,
    });
    // Nova lozinka gasi sve ranije sesije (ako je neko drugi znao staru)
    if (purpose === "reset") await revokeSessions(user._id);
    const problem = accessProblem(user);
    if (problem) {
      await user.save();
      throw httpError(403, problem);
    }
    return startSession(req, res, user, "password");
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/forgot  { identifier } — uvek isti odgovor (ne otkriva ko postoji)
const forgotPassword = async (req: Request, res: Response) => {
  try {
    const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim().toLowerCase() : "";
    if (!identifier) throw httpError(400, "Unesite e-mail ili korisničko ime.");
    const message = isMailEnabled()
      ? "Ako nalog postoji i ima e-mail adresu, poslali smo link za novu lozinku."
      : "Za novu lozinku obratite se upravi doma — oni vam šalju link.";
    if (!isMailEnabled()) return res.json({ success: true, message, emailEnabled: false });

    const user = identifier.includes("@") ? await User.findOne({ email: identifier }) : await User.findOne({ username: identifier });
    if (user?.email && canSignIn(user)) {
      const { url } = await issueLink(user, "reset", 1);
      const facility = (await GlobalSetting.findOne().lean())?.facility?.name || "Medikalija";
      await sendMail({
        to: user.email,
        subject: `${facility}: nova lozinka`,
        ...linkEmail({
          facility,
          greeting: `Zdravo ${user.name},`,
          body: "Zatražena je nova lozinka za vaš nalog. Link važi 1 sat.",
          action: "Postavi novu lozinku",
          url,
          footer: "Ako niste vi tražili, ignorišite ovu poruku — lozinka ostaje ista.",
        }),
      });
    }
    res.json({ success: true, message, emailEnabled: true });
  } catch (err) {
    fail(res, err);
  }
};

// ------------------ SOPSTVENI NALOG ------------------
// POST /api/auth/password  { currentPassword, newPassword } — gasi ostale sesije
const changePassword = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) throw httpError(404, "Korisnik ne postoji.");
    if (user.passwordHash) {
      if (typeof req.body?.currentPassword !== "string" || !(await bcrypt.compare(req.body.currentPassword, user.passwordHash))) {
        throw httpError(400, "Trenutna lozinka nije tačna.");
      }
    }
    assertStrongPassword(req.body?.newPassword, user);
    user.set({ passwordHash: await bcrypt.hash(req.body.newPassword, BCRYPT_COST), passwordChangedAt: new Date() });
    await user.save();
    await revokeSessions(user._id, req.sessionId);
    res.json({ success: true, message: "Lozinka je promenjena. Odjavljeni ste sa ostalih uređaja." });
  } catch (err) {
    fail(res, err);
  }
};

const getCurrentUser = (req: Request, res: Response) => res.status(200).json({ success: true, user: req.user });

// GET /api/auth/config — šta je uključeno (za ekran prijave)
const authConfig = (_req: Request, res: Response) => res.json({ success: true, googleClientId: googleClientId(), emailEnabled: isMailEnabled() });

export { login, googleLogin, refresh, logout, mySessions, endSession, endOtherSessions, getLink, acceptLink, forgotPassword, changePassword, getCurrentUser, authConfig };
