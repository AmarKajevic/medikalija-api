import { securityEvent } from "./logger.js";

// Obavezne promenljive okruženja: bez njih aplikacija ne sme tiho da radi
// (npr. JWT potpisan sa `undefined` ključem).
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Nedostaje promenljiva okruženja ${name}`);
  return value;
}

const MIN_SECRET_LENGTH = 32;
const PLACEHOLDERS = ["change-me", "changeme"];
const warned = new Set<string>();

/** Tajni ključ (npr. JWT_KEY). Slab ključ u produkciji se prijavljuje (jednom po procesu), ali ne ruši API. */
export function requireSecret(name: string): string {
  const value = requireEnv(name);
  const weak = value.length < MIN_SECRET_LENGTH || PLACEHOLDERS.some((p) => value.toLowerCase().includes(p));
  if (weak && process.env.NODE_ENV === "production" && !warned.has(name)) {
    warned.add(name);
    securityEvent("weak_secret", { name, hint: `najmanje ${MIN_SECRET_LENGTH} nasumičnih znakova (openssl rand -base64 48)` });
  }
  return value;
}
