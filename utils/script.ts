// Srpska latinica ⇄ ćirilica, za pretragu u oba pisma ("Милица" nalazi "Milica").
// Ista pravila kao na frontendu (src/shared/lib/script.ts).
const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", c: "ц", č: "ч", ć: "ћ", d: "д", đ: "ђ", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ј", k: "к",
  l: "л", m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", š: "ш", t: "т", u: "у", v: "в", z: "з", ž: "ж",
  A: "А", B: "Б", C: "Ц", Č: "Ч", Ć: "Ћ", D: "Д", Đ: "Ђ", E: "Е", F: "Ф", G: "Г", H: "Х", I: "И", J: "Ј", K: "К",
  L: "Л", M: "М", N: "Н", O: "О", P: "П", R: "Р", S: "С", Š: "Ш", T: "Т", U: "У", V: "В", Z: "З", Ž: "Ж",
};
const DIGRAPHS: Record<string, string> = { lj: "љ", Lj: "Љ", LJ: "Љ", nj: "њ", Nj: "Њ", NJ: "Њ", dž: "џ", Dž: "Џ", DŽ: "Џ" };
const CYR_TO_LAT: Record<string, string> = { љ: "lj", Љ: "Lj", њ: "nj", Њ: "Nj", џ: "dž", Џ: "Dž" };
for (const [lat, cyr] of Object.entries(LAT_TO_CYR)) CYR_TO_LAT[cyr] ??= lat;

export function toCyrillic(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (DIGRAPHS[two]) {
      out += DIGRAPHS[two];
      i++;
    } else out += LAT_TO_CYR[text[i]!] ?? text[i];
  }
  return out;
}

export const toLatin = (text: string): string => [...text].map((ch) => CYR_TO_LAT[ch] ?? ch).join("");
