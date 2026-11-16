// Podaci za obrasce postupka smeštaja (Word obrasci doma, ćirilica i latinica). Vrednosti su na
// latinici; aplikacija ih pri popuni preslovljava u pismo obrasca. Ovde se računa i rod reči
// ("мој-а" → "моја"), za korisnika (k_) i za potpisnika izjava/zahteva (p_).
import { scaleSummary, SCALE_GROUPS, SCALE_ITEMS, type ScaleScores } from "./supportScale.js";

type Sex = "" | "M" | "Ž" | undefined | null;

// [muški, ženski, kad pol nije poznat (kao u obrascu)]
const WORDS: Record<string, [string, string, string]> = {
  rodjen: ["rođen", "rođena", "rođen-a"],
  moga: ["moga", "moju", "moga-ju"],
  mu: ["mu", "joj", "mu-joj"],
  njegovom: ["njegovom", "njenom", "njegovom / njenom"],
  potpisani: ["potpisani", "potpisana", "potpisani-a"],
  doneo: ["doneo", "donela", "doneo-la"],
  primljen: ["primljen", "primljena", "primljen-na"],
  saglasan: ["saglasan", "saglasna", "saglasan-a"],
  upoznat: ["upoznat", "upoznata", "upoznat-a"],
  imao: ["imao", "imala", "imao-la"],
  moj: ["moj", "moja", "moj-a"],
  korisnik: ["korisnik", "korisnica", "korisnik-ca"],
  korisnika: ["korisnika", "korisnice", "korisnika-ce"],
  korisniku: ["korisniku", "korisnici", "korisniku-ci"],
  koji: ["koji", "koja", "koji-a"],
  dao: ["dao", "dala", "dao-la"],
  bio: ["bio", "bila", "bio-la"],
  smesten: ["smešten", "smeštena", "smešten-a"],
  podneo: ["podneo", "podnela", "podneo-la"],
};

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** k_rodjen / K_rodjen (veliko početno slovo) za korisnika i p_… za potpisnika */
export function genderWords(prefix: "k" | "p", sex: Sex): Record<string, string> {
  const i = sex === "M" ? 0 : sex === "Ž" ? 1 : 2;
  const out: Record<string, string> = {};
  for (const [key, forms] of Object.entries(WORDS)) {
    out[`${prefix}_${key}`] = forms[i];
    out[`${prefix.toUpperCase()}_${key}`] = cap(forms[i]);
  }
  return out;
}

/** Polja skale podrške: sk_<stavka>_ts / sk_<stavka>_oi, zbirovi po oblastima, ukupno i stepen */
export function scaleFields(scores: ScaleScores, levelLabel: (n: number) => string) {
  const out: Record<string, string> = {};
  const n = (v: number | null | undefined) => (v ? String(v) : "");
  for (const key of SCALE_ITEMS) {
    out[`sk_${key}_ts`] = n(scores[key]?.now);
    out[`sk_${key}_oi`] = n(scores[key]?.expected);
  }
  const summary = scaleSummary(scores);
  for (const g of summary.groups) {
    out[`sk_zbir_${g.key}_ts`] = g.now ? String(g.now) : "";
    out[`sk_zbir_${g.key}_oi`] = g.expected ? String(g.expected) : "";
  }
  out.sk_ukupno_ts = summary.totalNow ? String(summary.totalNow) : "";
  out.sk_ukupno_oi = summary.totalExpected ? String(summary.totalExpected) : "";
  out.sk_stepen = levelLabel(summary.level);
  return out;
}

export { SCALE_GROUPS };
