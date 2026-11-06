import type { NextFunction, Request, Response } from "express";
import type { Role } from "../models/User.js";

// Dozvoljava pristup samo navedenim ulogama. Koristi se posle authMiddleware.
export const MANAGER_ROLES: readonly Role[] = ["admin", "main-nurse"];
/** Sve uloge sa prijavom */
export const STAFF_ROLES: readonly Role[] = ["admin", "main-nurse", "nurse", "doctor", "social-worker"];
/** Zdravstveno osoblje: vidi medicinske podatke (svi osim socijalnog radnika) */
export const CLINICAL_ROLES: readonly Role[] = ["admin", "main-nurse", "nurse", "doctor"];
/** Smeju da zakazuju u kalendaru (svoje termine; uprava i tuđe) */
export const SCHEDULER_ROLES: readonly Role[] = ["admin", "main-nurse", "doctor", "social-worker"];

export const isManagerRole = (role: unknown): boolean => MANAGER_ROLES.includes(role as Role);

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role as Role)) {
      return res.status(403).json({ success: false, message: "Nemate dozvolu za ovu radnju." });
    }
    next();
  };

export const requireManager = requireRole(...MANAGER_ROLES);
export const requireStaff = requireRole(...STAFF_ROLES);
export const requireClinical = requireRole(...CLINICAL_ROLES);

// Dodavanje na stanje: porodične zalihe (fromFamily) unose sve uloge osoblja,
// a stanje doma i cene menja samo uprava.
export const requireManagerUnlessFamily = (req: Request, res: Response, next: NextFunction) =>
  req.body?.fromFamily ? next() : requireManager(req, res, next);
