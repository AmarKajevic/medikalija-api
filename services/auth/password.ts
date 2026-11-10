// Pravila za lozinku (NIST 800-63B): dužina umesto komplikovanih pravila,
// bez najčešćih lozinki i bez imena korisnika.
import { httpError } from "../../utils/errors.js";

const COMMON = new Set([
  "1234567890", "12345678910", "123456789a", "qwertyuiop", "password123", "lozinka123", "sifra12345", "šifra12345",
  "123456", "1234567", "12345678", "123456789", "654321", "111111", "000000", "qwerty", "qwertz", "abc123", "password",
  "lozinka", "sifra1", "šifra1", "sifra123", "medikalija", "medikalija1", "medikalija123", "0000000000", "1111111111", "abcdefghij", "qwerty1234", "1q2w3e4r5t",
]);

export const PASSWORD_MIN = 6;

export function assertStrongPassword(password: unknown, user: { name?: string; lastName?: string; email?: string | null; username?: string | null }) {
  if (typeof password !== "string") throw httpError(400, "Unesite lozinku.");
  if (password.length < PASSWORD_MIN) throw httpError(400, `Lozinka mora imati najmanje ${PASSWORD_MIN} znakova.`);
  if (password.length > 128) throw httpError(400, "Lozinka je predugačka.");
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) throw httpError(400, "Lozinka je previše laka za pogađanje.");
  const personal = [user.name, user.lastName, user.username, user.email?.split("@")[0]].filter((v): v is string => !!v && v.length >= 3);
  if (personal.some((p) => lower.includes(p.toLowerCase()))) throw httpError(400, "Lozinka ne sme da sadrži vaše ime ili korisničko ime.");
}
