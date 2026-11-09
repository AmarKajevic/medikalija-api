// Strukturisani logovi (jedan JSON red po događaju — Vercel ih prikazuje i pretražuje)
// i prijava neočekivanih grešaka u Sentry, ako je SENTRY_DSN podešen.
import * as Sentry from "@sentry/node";

const sentryEnabled = !!process.env.SENTRY_DSN && process.env.NODE_ENV !== "test";
if (sentryEnabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    // Bez ličnih podataka pacijenata u izveštajima o greškama
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
}

type Fields = Record<string, unknown>;

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** Neočekivana greška: log + Sentry. Poruka greške ide samo ovde, nikad klijentu. */
export function reportError(err: unknown, fields: Fields = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  write("error", "unexpected_error", { ...fields, name: e.name, message: e.message, stack: e.stack });
  if (sentryEnabled) Sentry.captureException(e, { extra: fields });
}

/** Bezbednosni događaj (npr. ponovna upotreba refresh tokena) — uvek se loguje, u Sentry kao upozorenje */
export function securityEvent(event: string, fields: Fields = {}) {
  write("warn", event, { security: true, ...fields });
  if (sentryEnabled) Sentry.captureMessage(event, { level: "warning", extra: fields });
}
