// Zaštita rute koja radi preko kolačića (osvežavanje i odjava) od zahteva sa tuđeg sajta (CSRF).
//  - Naša aplikacija šalje zaglavlje X-Requested-With: medikalija. Tuđ sajt ga ne može poslati:
//    zahtev sa posebnim zaglavljem traži CORS dozvolu, a CORS je samo za naše adrese. Ovo radi
//    nezavisno od adrese sa koje je aplikacija otvorena (rewrite, sopstveni domen, preview).
//  - Bez zaglavlja: prolazi zahtev bez Origin-a (server-server, nije browser, nema kolačića žrtve)
//    i zahtev sa naše adrese iz CORS_ORIGIN; sve ostalo se odbija.
import type { NextFunction, Request, Response } from "express";
import { allowedOrigins } from "../utils/cors.js";
import { securityEvent } from "../utils/logger.js";

export const CSRF_HEADER = "x-requested-with";
export const CSRF_VALUE = "medikalija";

export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (req.headers[CSRF_HEADER] === CSRF_VALUE) return next();
  const origin = req.headers.origin;
  if (!origin || allowedOrigins().includes(origin)) return next();
  securityEvent("bad_origin", { origin, path: req.originalUrl, ip: req.ip });
  return res.status(403).json({ success: false, code: "bad_origin", message: "Zahtev nije dozvoljen." });
}
