import { reportError } from "./logger.js";

// Greška sa HTTP statusom — servisi je bacaju, kontroleri je pretvaraju u odgovor.
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

export const GENERIC_ERROR = "Greška na serveru. Pokušajte ponovo.";

const knownStatus = (err: unknown): number | null => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
};

// `catch (err)` daje `unknown` — ove funkcije bezbedno čitaju poruku i status.
// Sve poruke grešaka ka klijentu prolaze ovuda: poruka namenjena korisniku (HttpError)
// ide kakva jeste, a neočekivana greška (baza, bug) se prijavljuje i klijent dobija opštu poruku —
// interni detalji (upiti, putanje, stack) ne izlaze iz API-ja.
export const errorMessage = (err: unknown): string => {
  // Naša greška (httpError) nosi poruku za korisnika, i kad je 503 ("mejl nije podešen")
  if (err instanceof HttpError) return err.message;
  const status = knownStatus(err);
  if (status !== null && status < 500 && err instanceof Error) return err.message;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "CastError") return "Neispravan identifikator.";
  if (name === "ValidationError") return "Neispravni podaci.";
  reportError(err);
  return GENERIC_ERROR;
};

export const statusOf = (err: unknown, fallback = 500): number => {
  const status = knownStatus(err);
  if (status !== null) return status;
  const name = (err as { name?: unknown } | null)?.name;
  return name === "CastError" || name === "ValidationError" ? 400 : fallback;
};
