import type { Request } from "express";

// Express 5 tipizuje parametre rute kao `string | string[]` (zbog wildcard ruta).
// Ovde uvek dobijamo jednu vrednost.
export const param = (req: Request, key: string): string => {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
};
