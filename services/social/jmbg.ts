// JMBG: DDMMGGG RR BBB K — dan, mesec, poslednje tri cifre godine, region, redni broj
// (000–499 muški, 500–999 ženski) i kontrolna cifra.

/** 13 cifara i ispravna kontrolna cifra */
export function isValidJmbg(jmbg: string): boolean {
  if (!/^\d{13}$/.test(jmbg)) return false;
  const d = [...jmbg].map(Number);
  const sum = [7, 6, 5, 4, 3, 2].reduce((s, k, i) => s + k * (d[i]! + d[i + 6]!), 0);
  let m = 11 - (sum % 11);
  if (m > 9) m = 0;
  return m === d[12];
}

/** Datum rođenja (UTC ponoć) i pol iz ispravnog JMBG-a; null ako datum ne postoji */
export function jmbgInfo(jmbg: string): { birthDate: Date; sex: "M" | "Ž" } | null {
  if (!isValidJmbg(jmbg)) return null;
  const day = Number(jmbg.slice(0, 2));
  const month = Number(jmbg.slice(2, 4));
  const yyy = Number(jmbg.slice(4, 7));
  const year = yyy >= 800 ? 1000 + yyy : 2000 + yyy;
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return null;
  return { birthDate, sex: Number(jmbg.slice(9, 12)) < 500 ? "M" : "Ž" };
}
