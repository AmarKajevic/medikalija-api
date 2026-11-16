// Skala za procenu stepena podrške (obrazac 11, čl. 14 Pravilnika o bližim uslovima i standardima).
// 25 stavki u 4 oblasti; svaka se ocenjuje za "stanje na prijemu (TS)" i "očekivani ishod".
// Ocena: 1 = samostalno, 2 = uz povremenu pomoć/nadzor, 3 = uz stalnu pomoć, 4 = potpuno zavisan.
// Stepen podrške (I–IV, čl. 15) se određuje iz proseka ocena stanja na prijemu: I = najviše podrške
// (potpuno zavisan), IV = samostalno uz podsećanje; pragovi su četvrtine raspona 1–4.
// Pretpostavka do potvrde socijalnog radnika — menja se samo ovde (i u aplikaciji, dossier.ts).

export const SCALE_MIN = 1;
export const SCALE_MAX = 4;

export const SCALE_GROUPS = [
  {
    key: "daily",
    label: "Svakodnevne životne aktivnosti",
    items: [
      ["toilet", "Upotreba toaleta"],
      ["hygiene", "Održavanje lične higijene"],
      ["dressing", "Oblačenje i svlačenje odeće"],
      ["footwear", "Obuvanje i izuvanje obuće"],
      ["meals", "Uzimanje obroka"],
      ["medication", "Uzimanje propisane terapije"],
    ],
  },
  {
    key: "instrumental",
    label: "Instrumentalne životne veštine",
    items: [
      ["transport", "Korišćenje javnog prevoza"],
      ["services", "Korišćenje javnih službi"],
      ["shopping", "Kupovina (namirnice i ostalo)"],
      ["money", "Raspolaganje novcem"],
      ["housekeeping", "Održavanje higijene ličnog i zajedničkog prostora"],
      ["cooking", "Pripremanje hrane i napitaka"],
      ["phone", "Korišćenje telefona"],
      ["orientationSpace", "Orijentacija u prostoru"],
    ],
  },
  {
    key: "social",
    label: "Funkcionisanje u socijalnom okruženju",
    items: [
      ["rules", "Odnos prema pravilima"],
      ["peers", "Odnos prema vršnjacima"],
      ["others", "Odnos prema drugim osobama"],
      ["family", "Održavanje porodičnih odnosa"],
      ["groups", "Grupne aktivnosti — učešće u aktivnostima u zajednici"],
      ["danger", "Izbegavanje opasnosti"],
      ["orientationTime", "Orijentacija u vremenu"],
      ["communication", "Komunikacija"],
      ["aggression", "Agresivnost"],
    ],
  },
  {
    key: "mobility",
    label: "Mobilnost",
    items: [
      ["indoor", "Mobilnost unutar ustanove"],
      ["outdoor", "Mobilnost u spoljnoj sredini"],
    ],
  },
] as const;

export const SCALE_ITEMS: readonly string[] = SCALE_GROUPS.flatMap((g) => g.items.map(([key]) => key));

export type ScaleScores = Record<string, { now?: number | null; expected?: number | null }>;

/** Zbir po oblastima i ukupno (samo unete ocene) i stepen podrške iz proseka ocena stanja na prijemu */
export function scaleSummary(scores: ScaleScores) {
  const sum = (keys: readonly string[], col: "now" | "expected") => keys.reduce((s, k) => s + (Number(scores[k]?.[col]) || 0), 0);
  const groups = SCALE_GROUPS.map((g) => {
    const keys = g.items.map(([k]) => k);
    return { key: g.key, now: sum(keys, "now"), expected: sum(keys, "expected") };
  });
  const rated = SCALE_ITEMS.filter((k) => Number(scores[k]?.now) >= SCALE_MIN);
  const totalNow = sum(SCALE_ITEMS, "now");
  const totalExpected = sum(SCALE_ITEMS, "expected");
  return { groups, totalNow, totalExpected, rated: rated.length, level: levelFor(rated.length ? totalNow / rated.length : 0) };
}

/** Prosek ocena 1–4 → stepen podrške I–IV (veća zavisnost = niži stepen); 0 = nije ocenjeno */
export function levelFor(average: number): number {
  if (!(average >= SCALE_MIN)) return 0;
  if (average <= 1.75) return 4;
  if (average <= 2.5) return 3;
  if (average <= 3.25) return 2;
  return 1;
}
