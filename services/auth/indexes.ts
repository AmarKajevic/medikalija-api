// Samopopravka indeksa korisnika pri pokretanju servera.
//
// Stare baze imaju jedinstveni indeks "email_1" BEZ uslova, pa dva korisnika bez
// e-maila (pozvani korisničkim imenom, osoblje bez prijave) prave "duplikat".
// Mongoose ne može sam da zameni indeks istog imena, pa se ovde zamenjuje
// indeksom koji važi samo kad e-mail postoji. Bezbedno je pokretati više puta.
import User from "../../models/User.js";

let done: Promise<void> | null = null;

async function repair() {
  const collection = User.collection;
  const indexes = await collection.indexes().catch(() => []);
  for (const field of ["email", "username", "googleId"]) {
    const old = indexes.find((i) => i.name === `${field}_1` && i.unique && !i.partialFilterExpression);
    if (old) {
      await collection.dropIndex(old.name!);
      console.log(`Indeks ${old.name} zamenjen (dozvoljava korisnike bez polja ${field}).`);
    }
  }
  // Stari zapisi sa praznim stringom bi i dalje bili "isti" — uklanja se polje
  await collection.updateMany({ email: { $in: ["", null] } }, { $unset: { email: "" } });
  await User.createIndexes();
}

export function ensureUserIndexes() {
  done ??= repair().catch((err) => {
    done = null;
    console.error("Popravka indeksa korisnika nije uspela:", err);
  });
  return done;
}
