import type { NextFunction, Request, Response } from "express";
import User, { canSignIn } from "../models/User.js";
import { allowedByScope } from "./roleScope.js";
import { AccessTokenError, isSessionActive, verifyAccessToken } from "../services/auth/sessions.js";
import { reportError } from "../utils/logger.js";

// 401 = nije prijavljen / token ne važi (frontend tada osvežava sesiju ili vodi na prijavu);
// 403 = prijavljen, ali uloga nema pravo. `code` kaže frontendu šta se desilo.
const unauthorized = (res: Response, code: string, message: string) => res.status(401).json({ success: false, code, message });

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized(res, "token_missing", "Niste prijavljeni.");

  let claims: { userId: string; sessionId: string };
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    const code = err instanceof AccessTokenError ? err.code : "token_invalid";
    return unauthorized(res, code, code === "token_expired" ? "Sesija je istekla." : "Neispravan token.");
  }

  try {
    // Korisnik i sesija paralelno: suspendovanje, odjava uređaja i nova lozinka važe odmah
    const [user, sessionActive] = await Promise.all([User.findById(claims.userId).select("-passwordHash"), isSessionActive(claims.sessionId, claims.userId)]);
    if (!user) return unauthorized(res, "token_invalid", "Neispravan token.");
    if (!sessionActive) return unauthorized(res, "session_revoked", "Sesija je završena. Prijavite se ponovo.");
    if (!canSignIn(user)) return unauthorized(res, "access_revoked", "Pristup je ukinut.");

    if (!allowedByScope(user.role, req)) {
      return res.status(403).json({ success: false, code: "forbidden", message: "Nemate pristup ovim podacima." });
    }

    req.user = user;
    req.sessionId = claims.sessionId;
    next();
  } catch (err) {
    reportError(err, { where: "authMiddleware" });
    return res.status(503).json({ success: false, message: "Provera prijave trenutno nije moguća. Pokušajte ponovo." });
  }
};

export default authMiddleware;
