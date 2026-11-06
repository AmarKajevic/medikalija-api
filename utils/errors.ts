// Greška sa HTTP statusom — servisi je bacaju, kontroleri je pretvaraju u odgovor.
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const httpError = (status: number, message: string) => new HttpError(status, message);

// `catch (err)` daje `unknown` — ove funkcije bezbedno čitaju poruku i status.
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : typeof err === "string" ? err : "Nepoznata greška";

export const statusOf = (err: unknown, fallback = 500): number => {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : fallback;
};
