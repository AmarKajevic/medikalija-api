// Obavezne promenljive okruženja: bez njih aplikacija ne sme tiho da radi
// (npr. JWT potpisan sa `undefined` ključem).
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Nedostaje promenljiva okruženja ${name}`);
  return value;
}
