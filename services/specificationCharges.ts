// services/specificationCharges.ts
//
// Jedino mesto gde se stavke dodaju u specifikaciju i uklanjaju iz nje, i gde se
// pri tome menja stanje lekova/artikala. Pravila:
//  - prvo se uzima porodično stanje pacijenta, ostatak sa stanja doma
//  - u specifikaciju (naplata) ide SAMO ono što je uzeto sa stanja doma
//  - stanje se menja atomično (uslovni $inc), pa dve sestre koje istovremeno
//    daju isti lek ne mogu da odu u minus
//  - ako bilo koji korak ne uspe, prethodni koraci se poništavaju
//  - brisanje stavke vraća stanje i briše zapise o potrošnji
import type { HydratedDocument, Model, Types } from "mongoose";
import Medicine from "../models/Medicine.js";
import Article from "../models/Articles.js";
import PatientMedicine from "../models/PatientMedicine.js";
import PatientArticle from "../models/PatientArticle.js";
import UsedMedicine from "../models/UsedMedicine.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedCombinations from "../models/UsedCombinations.js";
import Specification, { type SpecificationDoc, type SpecificationItem } from "../models/Specification.js";
import type { UserAttrs } from "../models/User.js";
import { MANAGER_ROLES, isManagerRole } from "../middleware/requireRole.js";
import { httpError } from "../utils/errors.js";
import { getActiveSpecification } from "./getOrCreateActiveSpecification.js";

export { MANAGER_ROLES, httpError };

type Id = Types.ObjectId | string;
type Actor = HydratedDocument<UserAttrs>;

export const round2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

// Ukupno = zbir svih stavki. Dodatni troškovi su i sami stavke (category "extra"),
// pa se `extraCosts` NE dodaje ponovo — ranije su se oni brojali dva puta čim bi
// se posle dodatnog troška dodao lek.
export function recalcSpecTotals(spec: SpecificationDoc): SpecificationDoc {
  const sumOf = (items: SpecificationItem[]) => items.reduce((sum, i) => sum + (Number(i.price) || 0), 0);
  spec.extraCosts = round2(sumOf(spec.items.filter((i) => i.category === "extra")));
  spec.totalPrice = round2(sumOf(spec.items));
  return spec;
}

export async function requireActiveSpecification(patientId: Id): Promise<SpecificationDoc> {
  const spec = await getActiveSpecification(patientId);
  if (!spec) {
    throw httpError(409, "Pacijent nema aktivnu specifikaciju (otpušten je ili ne postoji).");
  }
  return spec;
}

// Primenjuje izmenu na specifikaciju i čuva je. Šema koristi optimistic
// concurrency: ako je neko drugi u međuvremenu sačuvao istu specifikaciju,
// učitava se sveža verzija i izmena se primenjuje ponovo (bez gubitka stavki).
export async function mutateSpec<R>(spec: SpecificationDoc, apply: (s: SpecificationDoc) => R): Promise<{ spec: SpecificationDoc; result: R }> {
  let current = spec;
  for (let attempt = 0; ; attempt++) {
    const result = apply(current);
    recalcSpecTotals(current);
    try {
      await current.save();
      return { spec: current, result };
    } catch (err) {
      if ((err as { name?: string }).name !== "VersionError" || attempt >= 4) throw err;
      const fresh = await Specification.findById(spec._id);
      if (!fresh) throw httpError(404, "Specifikacija nije pronađena.");
      current = fresh;
    }
  }
}

// Lekovi i artikli imaju istu strukturu stanja; modeli se ovde svode na zajednički
// oblik (jedina konverzija tipova u modulu — šeme su proverene u models/).
interface StockAttrs {
  name: string;
  quantity: number;
  unitsPerPackage?: number | null;
  familyQuantity?: number | null;
  pricePerUnit?: number | null;
  price?: number | null;
}
interface FamilyStockAttrs {
  patient: Types.ObjectId;
  quantity: number;
}
type StockModel = Model<StockAttrs>;
type FamilyModel = Model<FamilyStockAttrs>;
interface UsedAttrs {
  patient: Id;
  medicine?: Id;
  article?: Id;
  amount: number;
  familyAmount?: number;
  homeAmount?: number;
  fromFamily: boolean;
  priceAtTheTime: number;
  createdBy: Types.ObjectId;
  roleUsed?: string;
}
type UsedModel = Model<UsedAttrs>;

interface ConsumableKind {
  Item: StockModel;
  Family: FamilyModel;
  Used: UsedModel;
  ref: "medicine" | "article";
  priceField: "pricePerUnit" | "price";
  category: "medicine" | "articles";
  label: string;
  recalcPackages(doc: StockAttrs): Record<string, number>;
}

export type ConsumableKindName = "medicine" | "article";

const KINDS: Record<ConsumableKindName, ConsumableKind> = {
  medicine: {
    Item: Medicine as unknown as StockModel,
    Family: PatientMedicine as unknown as FamilyModel,
    Used: UsedMedicine as unknown as UsedModel,
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
    Item: Article as unknown as StockModel,
    Family: PatientArticle as unknown as FamilyModel,
    Used: UsedArticles as unknown as UsedModel,
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
const roundedQuantity = (delta: number) => [
  { $set: { quantity: { $round: [{ $add: [{ $ifNull: ["$quantity", 0] }, delta] }, 4] } } },
];

// Atomično skida `amount` sa dokumenta samo ako ga ima dovoljno.
async function takeStock<T extends { quantity: number }>(model: Model<T>, filter: Record<string, unknown>, amount: number) {
  return model.findOneAndUpdate({ ...filter, quantity: { $gte: amount - EPS } }, roundedQuantity(-amount), { new: true });
}

async function giveStock<T extends { quantity: number }>(
  model: Model<T>,
  filter: Record<string, unknown>,
  amount: number,
  { upsert = false } = {}
) {
  if (amount <= 0) return null;
  return model.findOneAndUpdate(filter, roundedQuantity(amount), { new: true, upsert });
}

async function syncPackages(kind: ConsumableKind, doc: (StockAttrs & { _id?: unknown }) | null): Promise<void> {
  if (!doc || !doc._id) return;
  await kind.Item.updateOne({ _id: doc._id }, { $set: kind.recalcPackages(doc) });
}

interface EntryInput {
  usedRecord?: Types.ObjectId;
  homeAmount?: number;
  familyAmount?: number;
  price: number;
  createdBy: Types.ObjectId;
}

interface UpsertInput {
  category: string;
  ref: "medicine" | "article" | "combination";
  refId: Types.ObjectId;
  name: string;
  amount: number;
  price: number;
  entry: EntryInput;
  extra?: { analyses?: Array<{ _id: Types.ObjectId; name: string; price: number }> };
}

function upsertItem(spec: SpecificationDoc, { category, ref, refId, name, amount, price, entry, extra = {} }: UpsertInput) {
  const item = spec.items.find(
    (i) => i.category === category && (i[ref] ? String(i[ref]) === String(refId) : i.name === name)
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

interface ConsumeInput {
  patientId: Id;
  itemId: Id;
  amount: unknown;
  user: Actor;
}

// Daje lek/artikal pacijentu. Za sestre se samo beleži potrošnja (stanje i
// specifikaciju menja glavna sestra/admin, kao i do sada).
export async function consumeForPatient(kindName: ConsumableKindName, { patientId, itemId, amount, user }: ConsumeInput) {
  const kind = KINDS[kindName];
  const useAmount = round2(amount);
  if (!useAmount || useAmount <= 0) throw httpError(400, "Neispravna količina.");

  const item = await kind.Item.findById(itemId);
  if (!item) throw httpError(404, kindName === "medicine" ? "Lek nije pronađen." : "Artikal nije pronađen.");

  const unitPrice = Number(item[kind.priceField]) || 0;

  if (!isManagerRole(user.role)) {
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

  const familyDoc = await kind.Family.findOne({ patient: patientId, [kind.ref]: itemId });
  const familyUsed = round2(Math.min(Math.max(familyDoc?.quantity || 0, 0), useAmount));
  const homeUsed = round2(useAmount - familyUsed);

  if (homeUsed > (item.quantity || 0) + EPS) {
    throw httpError(400, `Nedovoljno ${kind.label} na stanju doma (traženo ${homeUsed}, dostupno ${round2(item.quantity)}).`);
  }

  const undo: Array<() => Promise<unknown>> = [];
  try {
    if (familyDoc && familyUsed > 0) {
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

interface CombinationInput {
  _id: Types.ObjectId;
  name: string;
  analyses: Array<{ _id: Types.ObjectId; name: string; price?: number | null }>;
}

export async function addCombinationCharge({ patientId, combination, user }: { patientId: Id; combination: CombinationInput; user: Actor }) {
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

export async function addExtraCharge(spec: SpecificationDoc, { label, amount, user }: { label?: string; amount: unknown; user: Actor }) {
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
export async function removeSpecItem(specId: Id, itemId: Id) {
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
  const kind = removed.category === "medicine" ? KINDS.medicine : removed.category === "articles" ? KINDS.article : null;
  const usedIds = entries.map((e) => e.usedRecord).filter(Boolean);
  let fullyReverted = removed.category === "extra";

  const refId = kind ? removed[kind.ref] : null;
  if (kind && refId && entries.length > 0) {
    for (const e of entries) {
      if (e.homeAmount > 0) {
        await syncPackages(kind, await giveStock(kind.Item, { _id: refId }, e.homeAmount));
      }
      if (e.familyAmount > 0) {
        await giveStock(kind.Family, { patient: saved.patientId, [kind.ref]: refId }, e.familyAmount, { upsert: true });
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
