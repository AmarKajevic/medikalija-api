// Upravljanje korisnicima — pristup samo po pozivu.
// Admin poziva osobu (e-mail ili korisničko ime + uloga); osoba otvara link i
// postavlja lozinku ili se prijavljuje Google-om. Bez mejl servisa admin kopira link.
import type { Request, Response } from "express";
import mongoose, { type HydratedDocument } from "mongoose";
import User, { ACTIVE_ROLES, PASSIVE_ROLES, isActiveRole, type UserAttrs } from "../models/User.js";
import GlobalSetting from "../models/GlobalSetting.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { isMailEnabled, linkEmail, sendMail } from "../utils/mailer.js";
import { findByLink, issueLink, type LinkPurpose } from "../services/auth/links.js";
import { revokeSessions } from "./authController.js";

type UserDoc = HydratedDocument<UserAttrs>;

const ROLE_LABEL: Record<string, string> = {
  admin: "administrator",
  "main-nurse": "glavna sestra",
  nurse: "medicinska sestra",
  doctor: "doktor",
  "social-worker": "socijalni radnik",
};

const fail = (res: Response, err: unknown) => {
  if ((err as { code?: number }).code === 11000) {
    const field = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
    return res.status(409).json({ success: false, message: field === "username" ? "To korisničko ime je zauzeto." : "Korisnik sa tom e-mail adresom već postoji." });
  }
  res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

function readIdentity(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  if (!name || !lastName) throw httpError(400, "Unesite ime i prezime.");
  if (name.length > 60 || lastName.length > 60) throw httpError(400, "Ime ili prezime je predugačko.");
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim().toLowerCase() : undefined;
  if (email && !EMAIL.test(email)) throw httpError(400, "E-mail adresa nije ispravna.");
  const username = typeof body.username === "string" && body.username.trim() ? body.username.trim().toLowerCase() : undefined;
  if (username && !USERNAME.test(username)) throw httpError(400, "Korisničko ime: 3–30 znakova, mala slova, brojevi, tačka, crtica.");
  return { name, lastName, email, username };
}

async function facilityName() {
  return (await GlobalSetting.findOne().lean())?.facility?.name || "Medikalija";
}

function linkMessage(user: UserDoc, purpose: LinkPurpose, inviter: { name: string; lastName: string }, facility: string, url: string) {
  return {
    subject: purpose === "invite" ? `Pozivnica za ${facility}` : `${facility}: nova lozinka`,
    ...linkEmail(
      purpose === "invite"
        ? {
            facility,
            greeting: `Zdravo ${user.name},`,
            body: `${inviter.name} ${inviter.lastName} vas poziva da koristite aplikaciju doma kao ${ROLE_LABEL[user.role] ?? user.role}. Link važi 7 dana.`,
            action: "Prihvati pozivnicu",
            url,
            footer: "Ako ne očekujete ovu pozivnicu, ignorišite poruku.",
          }
        : {
            facility,
            greeting: `Zdravo ${user.name},`,
            body: "Uprava doma vam je poslala link za postavljanje nove lozinke. Link važi 24 sata.",
            action: "Postavi lozinku",
            url,
            footer: "Ako niste tražili novu lozinku, javite se upravi doma.",
          }
    ),
  };
}

/** Izdaje link i šalje ga mejlom ako je moguće; uvek vraća link (admin ga može kopirati) */
async function sendLink(user: UserDoc, purpose: LinkPurpose, inviter: { name: string; lastName: string }) {
  const { url, expiresAt } = await issueLink(user, purpose);
  let emailSent = false;
  if (user.email && isMailEnabled()) {
    emailSent = await sendMail({ to: user.email, ...linkMessage(user, purpose, inviter, await facilityName(), url) });
  }
  return { url, expiresAt, emailSent };
}

// POST /api/auth/links/send  { url, email } — šalje već izdat link na upisanu adresu.
// Link mora biti važeći (proverava se heš), pa se ne može poslati proizvoljan sadržaj.
export const emailExistingLink = async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) throw httpError(400, "Unesite ispravnu e-mail adresu.");
    const token = typeof req.body?.url === "string" ? req.body.url.split("/").pop() : "";
    const user = await findByLink(token);
    if (!user || !user.link?.purpose) throw httpError(410, "Link je istekao ili je zamenjen novim. Napravite novi.");
    if (!isMailEnabled()) throw httpError(503, "Slanje mejlova nije podešeno na serveru.");
    const sent = await sendMail({ to: email, ...linkMessage(user, user.link.purpose as LinkPurpose, req.user, await facilityName(), req.body.url) });
    if (!sent) throw httpError(502, "Mejl nije poslat. Proverite adresu ili pokušajte kasnije.");
    res.json({ success: true, message: `Link je poslat na ${email}.` });
  } catch (err) {
    fail(res, err);
  }
};

async function loadTarget(req: Request) {
  const id = param(req, "id");
  if (!mongoose.isValidObjectId(id)) throw httpError(400, "Neispravan korisnik.");
  const user = await User.findById(id);
  if (!user) throw httpError(404, "Korisnik nije pronađen.");
  return user;
}

async function isLastAdmin(user: UserDoc) {
  if (user.role !== "admin") return false;
  const others = await User.countDocuments({ _id: { $ne: user._id }, role: "admin", status: { $ne: "suspended" }, loginAllowed: { $ne: false } });
  return others === 0;
}

// GET /api/auth/users
export const listUsers = async (_req: Request, res: Response) => {
  try {
    const users = await User.find().sort({ lastName: 1, name: 1 }).collation({ locale: "sr" }).populate("invitedBy", "name lastName");
    res.json({ success: true, users });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/invitations  { name, lastName, email?, username?, role }
export const inviteUser = async (req: Request, res: Response) => {
  try {
    const identity = readIdentity(req.body ?? {});
    const role = String(req.body?.role ?? "");
    if (!isActiveRole(role)) throw httpError(400, "Izaberite ulogu sa pristupom aplikaciji.");
    if (!identity.email && !identity.username) throw httpError(400, "Unesite e-mail ili korisničko ime (za osoblje bez mejla).");

    // Adresa ili korisničko ime već postoji: reći kome pripada i šta da se uradi
    const existing = await User.findOne({ $or: [identity.email ? { email: identity.email } : null, identity.username ? { username: identity.username } : null].filter(Boolean) as object[] });
    if (existing) {
      const who = `${existing.name} ${existing.lastName}`;
      const field = identity.email && existing.email === identity.email ? "e-mail adresa" : "korisničko ime";
      const message = !isActiveRole(existing.role) || existing.loginAllowed === false
        ? `Ova ${field} je upisana kod osobe ${who} u evidenciji osoblja bez pristupa.`
        : existing.status === "suspended"
          ? `Ova ${field} pripada korisniku ${who} kome je ukinut pristup. Vratite mu pristup umesto nove pozivnice.`
          : existing.status === "invited"
            ? `${who} već ima pozivnicu sa ovom adresom. Pošaljite novu pozivnicu.`
            : `Ova ${field} pripada aktivnom korisniku ${who}.`;
      return res.status(409).json({
        success: false,
        message,
        existing: { _id: existing._id, name: existing.name, lastName: existing.lastName, status: existing.status ?? "active", canLogin: isActiveRole(existing.role) && existing.loginAllowed !== false },
      });
    }

    const user = await User.create({ ...identity, role, status: "invited", loginAllowed: true, passwordHash: null, invitedBy: req.user._id, invitedAt: new Date() });
    const link = await sendLink(user, "invite", req.user);
    res.status(201).json({ success: true, user, invite: link });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/users/:id/invite — nova pozivnica (stara prestaje da važi)
export const resendInvite = async (req: Request, res: Response) => {
  try {
    const user = await loadTarget(req);
    if (user.status !== "invited") throw httpError(409, "Korisnik je već prihvatio pozivnicu. Pošaljite mu link za novu lozinku.");
    const link = await sendLink(user, "invite", req.user);
    res.json({ success: true, invite: link });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/users/:id/reset-link — link za novu lozinku (npr. zaboravljena, a nema mejl)
export const sendResetLink = async (req: Request, res: Response) => {
  try {
    const user = await loadTarget(req);
    if (!isActiveRole(user.role) || user.loginAllowed === false) throw httpError(400, "Ova uloga nema pristup aplikaciji.");
    if (user.status === "invited") throw httpError(409, "Korisnik još nije prihvatio pozivnicu — pošaljite pozivnicu ponovo.");
    const link = await sendLink(user, "reset", req.user);
    res.json({ success: true, link });
  } catch (err) {
    fail(res, err);
  }
};

// PATCH /api/auth/users/:id  { role?, status?: "active" | "suspended", name?, lastName?, email?, username? }
export const updateUser = async (req: Request, res: Response) => {
  try {
    const user = await loadTarget(req);
    const self = String(user._id) === String(req.user._id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (body.role !== undefined) {
      const role = String(body.role);
      const allowed = isActiveRole(user.role) ? (ACTIVE_ROLES as readonly string[]) : (PASSIVE_ROLES as readonly string[]);
      if (!allowed.includes(role)) throw httpError(400, "Nedozvoljena uloga.");
      if (self && role !== user.role) throw httpError(400, "Ne možete promeniti sopstvenu ulogu.");
      if (role !== "admin" && (await isLastAdmin(user))) throw httpError(409, "Ovo je jedini administrator — prvo postavite drugog.");
      user.role = role as UserAttrs["role"];
    }

    if (body.status !== undefined) {
      if (body.status !== "active" && body.status !== "suspended") throw httpError(400, "Nepoznat status.");
      if (self) throw httpError(400, "Ne možete suspendovati sopstveni nalog.");
      if (body.status === "suspended") {
        if (await isLastAdmin(user)) throw httpError(409, "Ovo je jedini administrator — prvo postavite drugog.");
        user.status = "suspended";
        user.set({ link: { tokenHash: null, purpose: null, expiresAt: null } });
        await revokeSessions(user._id);
      } else {
        // Ponovo aktivan samo ako ima način prijave; inače čeka pozivnicu
        user.status = user.passwordHash || user.googleId ? "active" : "invited";
        user.set({ failedLogins: 0, lockedUntil: null });
      }
    }

    if (["name", "lastName", "email", "username"].some((k) => body[k] !== undefined)) {
      const identity = readIdentity({ name: body.name ?? user.name, lastName: body.lastName ?? user.lastName, email: body.email ?? user.email, username: body.username ?? user.username });
      if (isActiveRole(user.role) && !identity.email && !identity.username) throw httpError(400, "Korisnik mora imati e-mail ili korisničko ime.");
      user.set({ name: identity.name, lastName: identity.lastName, email: identity.email ?? undefined, username: identity.username ?? undefined });
    }

    await user.save();
    res.json({ success: true, user: await User.findById(user._id).populate("invitedBy", "name lastName") });
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/auth/staff  { name, lastName, role, email? } — osoblje u evidenciji, bez prijave
export const addStaffRecord = async (req: Request, res: Response) => {
  try {
    const identity = readIdentity({ ...req.body, username: undefined });
    const role = String(req.body?.role ?? "");
    if (!(PASSIVE_ROLES as readonly string[]).includes(role)) throw httpError(400, "Izaberite ulogu osoblja bez pristupa.");
    const user = await User.create({ ...identity, role, loginAllowed: false, status: "active", passwordHash: null });
    res.status(201).json({ success: true, user });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/auth/users/:id — samo nalog koji nikad nije korišćen (pozivnica) ili evidencija bez prijave.
// Ostali se suspenduju, da ostane trag ko je šta uneo.
export const deleteUser = async (req: Request, res: Response) => {
  try {
    const user = await loadTarget(req);
    if (String(user._id) === String(req.user._id)) throw httpError(400, "Ne možete obrisati sopstveni nalog.");
    const neverUsed = user.status === "invited" && !user.lastLoginAt;
    if (!neverUsed && isActiveRole(user.role) && user.loginAllowed !== false) {
      throw httpError(409, "Korisnik je koristio aplikaciju — suspendujte ga umesto brisanja, da ostane trag ko je šta uneo.");
    }
    await revokeSessions(user._id);
    await user.deleteOne();
    res.json({ success: true, message: neverUsed ? "Pozivnica je povučena." : "Korisnik je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};
