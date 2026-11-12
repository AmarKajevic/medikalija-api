import Patient from "../models/Patient.js";
import { toLatin } from "../utils/script.js";
import { httpError } from "../utils/errors.js";

// Ključ za poređenje imena i prezimena: isto ime u ćirilici i latinici, sa ili bez kvačica,
// velikim ili malim slovima daje isti ključ ("Ђорђе Петровић" = "Đorđe Petrović" = "Djordje Petrovic").
export function patientNameKey(name?: string | null, lastName?: string | null) {
  return toLatin(`${name ?? ""} ${lastName ?? ""}`)
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // č ć š ž → c c s z
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Odbija novog (ili preimenovanog) pacijenta ako već postoji neko sa istim imenom i prezimenom */
export async function assertUniquePatientName(name: string, lastName: string, exceptId?: unknown) {
  const key = patientNameKey(name, lastName);
  if (!key) return;
  const others = await Patient.find(exceptId ? { _id: { $ne: exceptId } } : {}, { name: 1, lastName: 1 }).lean();
  const same = others.find((p) => patientNameKey(p.name, p.lastName) === key);
  if (same) throw httpError(409, `Korisnik „${same.name} ${same.lastName}” već postoji. Dva korisnika ne mogu imati isto ime i prezime.`);
}
