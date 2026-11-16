// Padeži za obrasce (srpska gramatika): lična imena i nazivi mesta, na latinici (aplikacija ih
// pri popuni preslovljava u pismo obrasca).
//
// Lična imena — kao u pravopisu:
//  • muško ime/prezime na suglasnik: Petar → Petra, Petru; Stevan → Stevana; Jovanović → Jovanovića
//    (nepostojano a: Petar, Aleksandar; prezimena na -ac: Stanac → Stanca)
//  • na -o i -e: Marko → Marka, Marku; Đorđe → Đorđa, Đorđu
//  • na -a (muško i žensko): Nikola → Nikole, Nikoli, Nikolu; Milica → Milice, Milici, Milicu
//    (lična imena bez glasovnih promena: Milka → Milki, ne "Milci")
//  • žensko prezime na suglasnik se ne menja: Milica Jovanović → Milici Jovanović
//  • žensko prezime pridevskog oblika na -ska/-cka/-čka: Kovačevska → Kovačevske, Kovačevskoj
//  • ostalo (strana imena na -i, -u…) ostaje kako jeste
//
// Mesta (prvi deo adrese ili opština): Beograd → iz Beograda, u Beogradu; Novi Sad → Novog Sada,
// Novom Sadu; Kragujevac → Kragujevca; Čačak → Čačka; Pančevo → Pančeva; Sremska Mitrovica →
// Sremske Mitrovice, Sremskoj Mitrovici. Nepoznat oblik ostaje kako je unet.

export type Case = "gen" | "dat" | "acc" | "loc";
type Sex = "" | "M" | "Ž" | undefined | null;

const VOWELS = "aeiou";
const keepCase = (orig: string, next: string) => (orig === orig.toUpperCase() && orig.length > 1 ? next.toUpperCase() : next);

/** Nastavci za imenicu na -a (ženska i muška imena na -a) */
const A_ENDINGS: Record<Case, string> = { gen: "e", dat: "i", acc: "u", loc: "i" };
/** Nastavci za muški rod na suglasnik, -o, -e */
const M_ENDINGS: Record<Case, string> = { gen: "a", dat: "u", acc: "a", loc: "u" };

/** Muška osnova bez nepostojanog a: Petar → Petr, Aleksandar → Aleksandr, Stanac → Stanc */
function maleStem(word: string, isSurname: boolean) {
  const lower = word.toLowerCase();
  if (/[td]ar$/.test(lower) && !isSurname) return word.slice(0, -2) + word.slice(-1); // Petar, Aleksandar
  if (/[^aeiou]ac$/.test(lower) && isSurname) return word.slice(0, -2) + word.slice(-1); // Stanac → Stanc
  return word;
}

function declineWord(word: string, kase: Case, sex: Sex, isSurname: boolean): string {
  if (!word) return word;
  const lower = word.toLowerCase();
  const last = lower.slice(-1);
  const female = sex === "Ž";
  if (last === "a") {
    // Žensko prezime pridevskog oblika: -ska, -cka, -čka
    if (female && isSurname && /(sk|ck|čk)a$/.test(lower)) {
      const adj: Record<Case, string> = { gen: "e", dat: "oj", acc: "u", loc: "oj" };
      return keepCase(word, word.slice(0, -1) + adj[kase]);
    }
    return keepCase(word, word.slice(0, -1) + A_ENDINGS[kase]);
  }
  if (female) return word; // žensko ime/prezime koje se ne završava na -a ne menja se
  if (last === "o" || last === "e") return keepCase(word, word.slice(0, -1) + M_ENDINGS[kase]);
  if (VOWELS.includes(last)) return word; // strana imena na -i, -u
  if (!/\p{L}/u.test(last)) return word;
  return keepCase(word, maleStem(word, isSurname) + M_ENDINGS[kase]);
}

/** Ime i prezime u padežu: "Milica Jovanović" (Ž) → dat "Milici Jovanović" */
export function declinePerson(firstName: string, lastName: string, sex: Sex, kase: Case): string {
  const first = firstName.trim().split(/\s+/).filter(Boolean).map((w) => declineWord(w, kase, sex, false));
  // Dvostruko prezime (Petrović-Njegoš): menja se svaki deo
  const last = lastName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split("-").map((part) => declineWord(part, kase, sex, true)).join("-"));
  return [...first, ...last].join(" ");
}

// ── Mesta ──
const SOFT = /(j|nj|lj|č|ć|š|ž|đ|dž)$/;

function declinePlaceWord(word: string, kase: "gen" | "loc", isAdjective: boolean): string {
  const lower = word.toLowerCase();
  if (isAdjective) {
    // Novi → Novog/Novom; Gornji → Gornjeg/Gornjem; Sremska → Sremske/Sremskoj; Staro → Starog/Starom
    if (lower.endsWith("a")) return keepCase(word, word.slice(0, -1) + (kase === "gen" ? "e" : "oj"));
    if (lower.endsWith("i") || lower.endsWith("o") || lower.endsWith("e")) {
      const stem = word.slice(0, -1);
      const soft = SOFT.test(stem.toLowerCase());
      return keepCase(word, stem + (kase === "gen" ? (soft ? "eg" : "og") : soft ? "em" : "om"));
    }
    return word;
  }
  if (lower.endsWith("a")) return keepCase(word, word.slice(0, -1) + (kase === "gen" ? "e" : "i")); // Mitrovica
  if (lower.endsWith("o") || lower.endsWith("e")) return keepCase(word, word.slice(0, -1) + (kase === "gen" ? "a" : "u")); // Pančevo, Užice
  if (/[aeiou]$/.test(lower) || !/\p{L}$/u.test(lower)) return word;
  // Nepostojano a: Kragujevac → Kragujevc-, Čačak → Čačk-, Voždovac → Voždovc-
  const stem = /[^aeiou]a[ck]$/.test(lower) ? word.slice(0, -2) + word.slice(-1) : word;
  return keepCase(word, stem + (kase === "gen" ? "a" : "u"));
}

/** Naziv mesta u genitivu ("iz Beograda") ili lokativu ("u Beogradu") */
export function declinePlace(place: string, kase: "gen" | "loc"): string {
  const words = place.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.some((w) => /\d/.test(w))) return place.trim(); // ulica sa brojem — ne menja se
  return words.map((w, i) => declinePlaceWord(w, kase, i < words.length - 1)).join(" ");
}

/** Adresa "Beograd, Vojvode Stepe 12" → "Beogradu, Vojvode Stepe 12" (menja se samo mesto, prvi deo) */
export function addressLocative(address: string): string {
  const [first = "", ...rest] = address.split(",");
  if (!first.trim()) return address.trim();
  return [declinePlace(first, "loc"), ...rest.map((r) => r.trim())].join(", ");
}
