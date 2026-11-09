// Zaštita rute koja radi preko kolačića (osvežavanje i odjava) od zahteva sa tuđeg sajta (CSRF).
// Browser uz svaki cross-origin POST šalje Origin; zahtev sa sajta koji nije naš se odbija.
// Bez Origin-a (server-server, testovi) zahtev nije iz browsera, pa nema ni kolačića žrtve.
import type { NextFunction, Request, Response } from "express";
import { allowedOrigins } from "../utils/cors.js";
import { securityEvent } from "../utils/logger.js";

export function originGuard(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins().includes(origin)) return next();
  securityEvent("bad_origin", { origin, path: req.originalUrl, ip: req.ip });
  return res.status(403).json({ success: false, code: "bad_origin", message: "Zahtev nije dozvoljen." });
}
