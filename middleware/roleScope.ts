// Uloge sa ograničenim pristupom: dozvoljeno je SAMO ono što je ovde navedeno.
// Mnoge starije rute proveravaju samo prijavu, pa se nova uloga ne oslanja na njih —
// sve što nije na listi je zabranjeno (i rute koje se dodaju kasnije).
import type { Request } from "express";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "*";
type Rule = [Method | Method[], string];

const SCOPES: Record<string, Rule[]> = {
  // Socijalni radnik: osnovni podaci o pacijentu, socijalni karton, kalendar.
  // Ne vidi specifikacije, lekove, artikle ni medicinsku dokumentaciju.
  "social-worker": [
    ["*", "/api/auth"],
    ["GET", "/api/patient"],
    ["*", "/api/social-notes"],
    ["*", "/api/calendar"],
    ["GET", "/api/dashboard"],
    ["*", "/api/notifications"],
    ["GET", "/api/search"],
    ["GET", "/api/settings"],
  ],
  // Fizioterapeut: osnovni podaci o pacijentu i unos fizikalne terapije (redovne se
  // beleže, vanredne idu upravi na odobrenje i naplatu), kalendar.
  physiotherapist: [
    ["*", "/api/auth"],
    ["GET", "/api/patient"],
    [["GET", "POST", "DELETE"], "/api/nurse-entries"],
    ["*", "/api/calendar"],
    ["GET", "/api/dashboard"],
    ["*", "/api/notifications"],
    ["GET", "/api/search"],
    ["GET", "/api/settings"],
  ],
};

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Da li uloga sme da pozove ovaj zahtev (uloge bez liste nisu ograničene ovde). */
export function allowedByScope(role: string, req: Pick<Request, "method" | "originalUrl">): boolean {
  const rules = SCOPES[role];
  if (!rules) return true;
  const path = req.originalUrl.split("?")[0]!.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  return rules.some(([m, prefix]) => {
    const methods = Array.isArray(m) ? m : [m];
    return (methods.includes("*") || methods.includes(method as Method)) && matches(path, prefix);
  });
}
