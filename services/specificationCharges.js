// services/specificationCharges.js
//
// Jedino mesto gde se stavke dodaju u specifikaciju i uklanjaju iz nje, i gde se
// pri tome menja stanje lekova/artikala. Pravila:
//  - prvo se uzima porodično stanje pacijenta, ostatak sa stanja doma
//  - u specifikaciju (naplata) ide SAMO ono što je uzeto sa stanja doma
//  - stanje se menja atomično (uslovni $inc), pa dve sestre koje istovremeno
//    daju isti lek ne mogu da odu u minus
//  - ako bilo koji korak ne uspe, prethodni koraci se poništavaju
//  - brisanje stavke vraća stanje i briše zapise o potrošnji
import Medicine from "../models/Medicine.js";
import Article from "../models/Articles.js";
import PatientMedicine from "../models/PatientMedicine.js";
import PatientArticle from "../models/PatientArticle.js";
import UsedMedicine from "../models/UsedMedicine.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedCombinations from "../models/UsedCombinations.js";
import Specification from "../models/Specification.js";
import { getActiveSpecification } from "./getOrCreateActiveSpecification.js";

export const MANAGER_ROLES = ["admin", "main-nurse"];

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Ukupno = zbir svih stavki. Dodatni troškovi su i sami stavke (category "extra"),
// pa se `extraCosts` NE dodaje ponovo — ranije su se oni brojali dva puta čim bi
// se posle dodatnog troška dodao lek.
export function recalcSpecTotals(spec) {
  const sumOf = (items) => items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  spec.extraCosts = round2(sumOf(spec.items.filter((i) => i.category === "extra")));
  spec.totalPrice = round2(sumOf(spec.items));
  return spec;
}

export async function requireActiveSpecification(patientId) {
  const spec = await getActiveSpecification(patientId);
  if (!spec) {
    throw httpError(409, "Pacijent nema aktivnu specifikaciju (otpušten je ili ne postoji).");
  }
  return spec;
}

// Primenjuje izmenu na specifikaciju i čuva je. Šema koristi optimistic
// concurrency: ako je neko drugi u međuvremenu sačuvao istu specifikaciju,
// učitava se sveža verzija i izmena se primenjuje ponovo (bez gubitka stavki).
export async function mutateSpec(spec, apply) {
  let current = spec;
  for (let attempt = 0; ; attempt++) {
    const result = apply(current);
    recalcSpecTotals(current);
    try {
      await current.save();
      return { spec: current, result };
    } catch (err) {
      if (err.name !== "VersionError" || attempt >= 4) throw err;
      current = await Specification.findById(spec._id);
      if (!current) throw httpError(404, "Specifikacija nije pronađena.");
    }
  }
}

const KINDS = {
  medicine: {
    Item: Medicine,
    Family: PatientMedicine,
    Used: UsedMedicine,
    ref: "medicine",
    priceField: "pricePerUnit",
    category: "medicine",
    label: "leka",
    recalcPackages(doc) {
      const u = doc.unitsPerPackage || 0;
      return { packageCount: u > 0 ? Math.floor((doc.quantity || 0) / u) : 0 };
    },
  },
  article: {
    Item: Article,
    Family: PatientArticle,
    Used: UsedArticles,
    ref: "article",
    priceField: "price",
    category: "articles",
    label: "artikla",
    recalcPackages(doc) {
      const u = doc.unitsPerPackage || 0;
      return {
        packageCount: u > 0 ? Math.floor((doc.quantity || 0) / u) : 0,
        familyPackageCount: u > 0 ? Math.floor((doc.familyQuantity || 0) / u) : 0,
      };
    },
  },
};

// Količine mogu biti decimalne (1/3 tablete), a 1 - 0.33 - 0.33 u binarnom
// zapisu nije tačno 0.34. Zato se poredi sa tolerancijom, a rezultat se
// zaokružuje u samoj bazi (pipeline update), pa greška ne može da se nakuplja.
const EPS = 1e-6;
const roundedQuantity = (delta) => [
  { $set: { quantity: { $round: [{ $add: [{ $ifNull: ["$quantity", 0] }, delta] }, 4] } } },
];

// Atomično skida `amount` sa dokumenta samo ako ga ima dovoljno.
async function takeStock(Model, filter, amount) {
  return Model.findOneAndUpdate(
    { ...filter, quantity: { $gte: amount - EPS } },
    roundedQuantity(-amount),
    { new: true }
  );
}

async function giveStock(Model, filter, amount, { upsert = false } = {}) {
  if (amount <= 0) return null;
  return Model.findOneAndUpdate(filter, roundedQuantity(amount), { new: true, upsert });
}

async function syncPackages(kind, doc) {
  if (!doc || !doc._id) return;
  await kind.Item.updateOne({ _id: doc._id }, { $set: kind.recalcPackages(doc) });
}

function upsertItem(spec, { category, ref, refId, name, amount, price, entry, extra = {} }) {
  const item = spec.items.find(
    (i) =>
      i.category === category &&
      (i[ref] ? String(i[ref]) === String(refId) : i.name === name)
  );

  if (item) {
    item.amount = round2((item.amount || 0) + amount);
    item.price = round2((item.price || 0) + price);
    item.date = new Date();
    if (!item[ref]) item[ref] = refId;
    item.entries.push(entry);
    return item;
  }

  spec.items.push({
    name,
    category,
    [ref]: refId,
    amount,
    price,
    date: new Date(),
    entries: [entry],
    ...extra,
  });
  return spec.items[spec.items.length - 1];
}

// Daje lek/artikal pacijentu. Za sestre se samo beleži potrošnja (stanje i
// specifikaciju menja glavna sestra/admin, kao i do sada).
export async function consumeForPatient(kindName, { patientId, itemId, amount, user }) {
  const kind = KINDS[kindName];
  const useAmount = round2(amount);
  if (!useAmount || useAmount <= 0) throw httpError(400, "Neispravna količina.");

  const item = await kind.Item.findById(itemId);
  if (!item) throw httpError(404, kindName === "medicine" ? "Lek nije pronađen." : "Artikal nije pronađen.");

  const unitPrice = Number(item[kind.priceField]) || 0;

  if (!MANAGER_ROLES.includes(user.role)) {
    const usedRecord = await kind.Used.create({
      patient: patientId,
      [kind.ref]: itemId,
      amount: useAmount,
      fromFamily: false,
      priceAtTheTime: unitPrice,
      createdBy: user._id,
      roleUsed: user.role,
    });
    return {
      usedRecord,
      specification: await getActiveSpecification(patientId),
      familyUsed: 0,
      homeUsed: 0,
      message: "Zabeleženo. Stanje i specifikaciju ažurira glavna sestra.",
    };
  }

  // Specifikacija se proverava PRE bilo kakve promene stanja.
  const spec = await requireActiveSpecification(patientId);

  const familyFilter = { patient: patientId, [kind.ref]: itemId };
  const familyDoc = await kind.Family.findOne(familyFilter);
  const familyUsed = round2(Math.min(Math.max(familyDoc?.quantity || 0, 0), useAmount));
  const homeUsed = round2(useAmount - familyUsed);

  if (homeUsed > (item.quantity || 0) + EPS) {
    throw httpError(
      400,
      `Nedovoljno ${kind.label} na stanju doma (traženo ${homeUsed}, dostupno ${round2(item.quantity)}).`
    );
  }

  const undo = [];
  try {
    if (familyUsed > 0) {
      const ok = await takeStock(kind.Family, { _id: familyDoc._id }, familyUsed);
      if (!ok) throw httpError(409, "Porodično stanje se upravo promenilo. Pokušajte ponovo.");
      undo.push(() => giveStock(kind.Family, { _id: familyDoc._id }, familyUsed));
    }

    if (homeUsed > 0) {
      const updated = await takeStock(kind.Item, { _id: itemId }, homeUsed);
      if (!updated) throw httpError(409, `Stanje ${kind.label} se upravo promenilo. Pokušajte ponovo.`);
      undo.push(async () => syncPackages(kind, await giveStock(kind.Item, { _id: itemId }, homeUsed)));
      await syncPackages(kind, updated);
    }

    const usedRecord = await kind.Used.create({
      patient: patientId,
      [kind.ref]: itemId,
      amount: useAmount,
      familyAmount: familyUsed,
      homeAmount: homeUsed,
      fromFamily: familyUsed > 0,
      priceAtTheTime: unitPrice,
      createdBy: user._id,
      roleUsed: user.role,
    });
    undo.push(() => kind.Used.deleteOne({ _id: usedRecord._id }));

    let savedSpec = spec;
    if (homeUsed > 0) {
      const price = round2(homeUsed * unitPrice);
      ({ spec: savedSpec } = await mutateSpec(spec, (s) =>
        upsertItem(s, {
          category: kind.category,
          ref: kind.ref,
          refId: item._id,
          name: item.name,
          amount: homeUsed,
          price,
          entry: { usedRecord: usedRecord._id, homeAmount: homeUsed, familyAmount: familyUsed, price, createdBy: user._id },
        })
      ));
    }

    const message =
      homeUsed === 0
        ? "Iskorišćeno sa porodičnog stanja — ne naplaćuje se."
        : familyUsed > 0
          ? `${familyUsed} sa porodičnog stanja, ${homeUsed} naplaćeno u specifikaciji.`
          : "Dodato u specifikaciju.";

    return { usedRecord, specification: savedSpec, familyUsed, homeUsed, message };
  } catch (err) {
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (undoErr) {
        console.error("consumeForPatient undo failed:", undoErr);
      }
    }
    throw err;
  }
}

export async function addCombinationCharge({ patientId, combination, user }) {
  const spec = await requireActiveSpecification(patientId);

  const analyses = combination.analyses.map((a) => ({ _id: a._id, name: a.name, price: Number(a.price) || 0 }));
  const price = round2(analyses.reduce((sum, a) => sum + a.price, 0));

  const usedCombination = await UsedCombinations.create({
    patient: patientId,
    combination: combination._id,
    analyses,
    totalPriceAtTheTime: price,
    createdBy: user._id,
  });

  try {
    const { spec: saved } = await mutateSpec(spec, (s) =>
      upsertItem(s, {
        category: "combination",
        ref: "combination",
        refId: combination._id,
        name: combination.name,
        amount: 1,
        price,
        entry: { usedRecord: usedCombination._id, price, createdBy: user._id },
        extra: { analyses },
      })
    );
    return { usedCombination, specification: saved };
  } catch (err) {
    await UsedCombinations.deleteOne({ _id: usedCombination._id });
    throw err;
  }
}

export async function addExtraCharge(spec, { label, amount, user }) {
  const price = round2(amount);
  if (!price || price <= 0) throw httpError(400, "Neispravan iznos troška.");

  const { spec: saved } = await mutateSpec(spec, (s) => {
    s.items.push({
      name: label?.trim() || "Dodatni trošak",
      category: "extra",
      amount: 1,
      price,
      date: new Date(),
      entries: [{ price, createdBy: user._id }],
    });
  });
  return saved;
}

// Uklanja stavku i poništava sve što je ona izazvala. Stavka se PRVO uklanja iz
// specifikacije (sa proverom verzije), pa se tek onda vraća stanje — tako dva
// istovremena brisanja iste stavke ne mogu da vrate stanje dva puta.
// Vraća { specification, fullyReverted } — fullyReverted je false za stare
// stavke koje nemaju zapisane `entries` (tada se uklanja samo trošak).
export async function removeSpecItem(specId, itemId) {
  const spec = await Specification.findById(specId);
  if (!spec) throw httpError(404, "Specifikacija nije pronađena.");

  const { spec: saved, result: removed } = await mutateSpec(spec, (s) => {
    const item = s.items.id(itemId);
    if (!item) throw httpError(404, "Stavka nije pronađena.");
    const snapshot = item.toObject();
    item.deleteOne();
    return snapshot;
  });

  const entries = removed.entries || [];
  const kind =
    removed.category === "medicine" ? KINDS.medicine : removed.category === "articles" ? KINDS.article : null;
  const usedIds = entries.map((e) => e.usedRecord).filter(Boolean);
  let fullyReverted = removed.category === "extra";

  if (kind && removed[kind.ref] && entries.length > 0) {
    for (const e of entries) {
      if (e.homeAmount > 0) {
        await syncPackages(kind, await giveStock(kind.Item, { _id: removed[kind.ref] }, e.homeAmount));
      }
      if (e.familyAmount > 0) {
        await giveStock(
          kind.Family,
          { patient: saved.patientId, [kind.ref]: removed[kind.ref] },
          e.familyAmount,
          { upsert: true }
        );
      }
    }
    await kind.Used.deleteMany({ _id: { $in: usedIds } });
    fullyReverted = true;
  } else if (removed.category === "combination" && usedIds.length > 0) {
    await UsedCombinations.deleteMany({ _id: { $in: usedIds } });
    fullyReverted = true;
  }

  return { specification: saved, fullyReverted };
}
