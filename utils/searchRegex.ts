// Pretraga u bazi po POČECIMA reči, bez obzira na kvačice i pismo:
// "zivk" nalazi "Živković" i "Живковић", ali "an" ne nalazi "Jovanović".
import { escapeRegex } from "./escapeRegex.js";
import { toCyrillic, toLatin } from "./script.js";

// Slova sa kvačicom i bez se poklapaju (korisnici često kucaju bez njih)
const LATIN_CLASS: Record<string, string> = {
  c: "[cčć]", č: "[cčć]", ć: "[cčć]",
  s: "[sš]", š: "[sš]",
  z: "[zž]", ž: "[zž]",
  đ: "(?:đ|dj)",
};

function latinPattern(word: string): string {
  let out = "";
  for (let i = 0; i < word.length; i++) {
    if (word.slice(i, i + 2) === "dj") {
      out += "(?:dj|đ)";
      i++;
      continue;
    }
    const ch = word[i]!;
    out += LATIN_CLASS[ch] ?? escapeRegex(ch);
  }
  return out;
}

/** Reči upita (najviše 5, bez interpunkcije) */
export const searchWords = (query: string) =>
  query.trim().toLowerCase().split(/[\s.,;:/()\-]+/).filter(Boolean).slice(0, 5);

/** Regex koji traži `word` na početku neke reči, u latinici i ćirilici */
export function wordStartRegex(word: string): RegExp {
  const latin = toLatin(word).toLowerCase();
  const cyrillic = toCyrillic(latin);
  const alternatives = [latinPattern(latin), escapeRegex(cyrillic)];
  // Reč počinje na početku polja ili posle razmaka, crtice, tačke, zareza, kose crte ili zagrade
  const wordStart = String.raw`(?:^|[\s\-.,/(])`;
  return new RegExp(`${wordStart}(?:${alternatives.join("|")})`, "i");
}

/** Mongo uslov: svaka reč upita je početak neke reči u bar jednom od polja */
export function wordStartQuery(query: string, fields: string[]) {
  const words = searchWords(query);
  if (!words.length) return null;
  return { $and: words.map((w) => ({ $or: fields.map((f) => ({ [f]: wordStartRegex(w) })) })) };
}
