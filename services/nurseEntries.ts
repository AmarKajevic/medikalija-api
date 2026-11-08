// services/nurseEntries.ts
//
// Unosi medicinskih sestara i njihovo odobravanje:
//  - sestra beleži dat lek, dat artikal ili urađenu uslugu nege iz kataloga
//  - ono što se naplaćuje čeka upravu: PRIHVATI → ista pravila kao kad uprava sama
//    unosi (prvo porodično stanje, ostatak sa stanja doma u aktivnu specifikaciju);
//    ODBIJ → ništa se ne naplaćuje i ništa se ne skida sa stanja
//  - svaka usluga nege ide na odobrenje i u specifikaciju (bez cene: stavka od 0 RSD, uprava upisuje cenu)
//  - unos uprave se odmah primenjuje (uprava ne odobrava sama sebi)
import type { HydratedDocument, Types } from "mongoose";
import Medicine from "../models/Medicine.js";
import Article from "../models/Articles.js";
import Patient from "../models/Patient.js";
import CareTask from "../models/CareTask.js";
import NurseEntry, { ENTRY_TYPES, type EntryType, type NurseEntryDoc } from "../models/NurseEntry.js";
import User, { type UserAttrs } from "../models/User.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { httpError } from "../utils/errors.js";
import { addServiceCharge, consumeForPatient, removeSpecItem, round2 } from "./specificationCharges.js";
import { resolveTargetSpecification } from "./getOrCreateActiveSpecification.js";

type Actor = HydratedDocument<UserAttrs>;

export interface EntryInput {
  type: unknown;
  itemId: unknown;
  amount?: unknown;
  note?: unknown;
  performedAt?: unknown;
}

const MAX_ENTRIES_PER_REQUEST = 50;
// Zaključavanje "processing" posle ovoliko se smatra prekinutim (pad servera) i unos se može ponovo prihvatiti
const STALE_LOCK_MS = 2 * 60_000;

const MODEL_BY_TYPE = { medicine: Medicine, article: Article, care: CareTask } as const;

function parsePerformedAt(value: unknown): Date {
  if (value === undefined || value === null || value === "") return new Date();
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw httpError(400, "Neispravno vreme unosa.");
  // Mala tolerancija za razliku u satu uređaja; budućnost nije dozvoljena
  if (d.getTime() > Date.now() + 5 * 60_000) throw httpError(400, "Vreme unosa ne može biti u budućnosti.");
  return d;
}

async function buildEntry(patientId: Types.ObjectId, input: EntryInput, user: Actor) {
  const type = input.type as EntryType;
  if (!ENTRY_TYPES.includes(type)) throw httpError(400, "Nepoznata vrsta unosa.");

  const amount = round2(input.amount ?? 1);
  if (!(amount > 0)) throw httpError(400, "Količina mora biti veća od nule.");
  if (amount > 10_000) throw httpError(400, "Količina je prevelika.");

  const Model = MODEL_BY_TYPE[type] as unknown as typeof CareTask;
  const item = await Model.findById(String(input.itemId ?? "")).catch(() => null);
  if (!item) throw httpError(404, type === "care" ? "Usluga nije pronađena." : type === "medicine" ? "Lek nije pronađen." : "Artikal nije pronađen.");
  if (type === "care" && item.active === false) throw httpError(400, `Usluga "${item.name}" više nije u upotrebi.`);

  return {
    patient: patientId,
    type,
    [type === "care" ? "careTask" : type]: item._id,
    name: item.name,
    amount,
    note: typeof input.note === "string" ? input.note.trim().slice(0, 500) : "",
    performedAt: parsePerformedAt(input.performedAt),
    createdBy: user._id,
    status: "pending" as const,
  };
}

/** Beleži jedan ili više unosa za pacijenta. Unosi uprave se odmah primenjuju (u izabran period, ako je dat). */
export async function createEntries(patientId: unknown, inputs: EntryInput[], user: Actor, specificationId?: unknown) {
  if (!Array.isArray(inputs) || inputs.length === 0) throw httpError(400, "Nema unosa.");
  if (inputs.length > MAX_ENTRIES_PER_REQUEST) throw httpError(400, "Previše unosa odjednom.");

  const patient = await Patient.findById(String(patientId ?? "")).catch(() => null);
  if (!patient) throw httpError(404, "Pacijent nije pronađen.");
  if (patient.dischargeDate) throw httpError(409, "Pacijent je otpušten — novi unosi nisu mogući.");

  // Sve se proverava pre upisa: ili prođu svi unosi, ili nijedan
  const docs = [];
  for (const input of inputs) docs.push(await buildEntry(patient._id, input, user));
  const created = await NurseEntry.insertMany(docs);

  if (!isManagerRole(user.role)) return { entries: created, applied: [] as AcceptResult[] };

  const applied: AcceptResult[] = [];
  for (const entry of created.filter((e) => e.status === "pending")) {
    applied.push(await acceptEntry(entry._id, user, undefined, specificationId).catch((err: Error) => ({ id: String(entry._id), ok: false as const, message: err.message })));
  }
  return { entries: await NurseEntry.find({ _id: { $in: created.map((e) => e._id) } }), applied };
}

export type AcceptResult =
  | { id: string; ok: true; message: string; entry: NurseEntryDoc }
  | { id: string; ok: false; message: string };

// Atomično preuzima unos za prihvatanje — drugi klik/korisnik dobija grešku umesto dvostruke naplate.
async function claim(entryId: unknown) {
  return NurseEntry.findOneAndUpdate(
    {
      _id: entryId,
      $or: [{ status: "pending" }, { status: "processing", updatedAt: { $lt: new Date(Date.now() - STALE_LOCK_MS) } }],
    },
    { $set: { status: "processing" } },
    { new: true }
  );
}

/** Prihvata unos: naplaćuje ga u aktivnoj specifikaciji. `amount` ispravlja količinu sestre. */
export async function acceptEntry(entryId: unknown, user: Actor, amount?: unknown, targetSpecificationId?: unknown): Promise<AcceptResult> {
  const id = String(entryId);
  const entry = await claim(entryId).catch(() => null);
  if (!entry) {
    const existing = await NurseEntry.findById(id).catch(() => null);
    if (!existing) throw httpError(404, "Unos nije pronađen.");
    throw httpError(409, existing.status === "accepted" ? "Unos je već prihvaćen." : existing.status === "rejected" ? "Unos je već odbijen." : "Unos je upravo u obradi.");
  }

  const release = () => NurseEntry.updateOne({ _id: entry._id, status: "processing" }, { $set: { status: "pending" } });

  try {
    const qty = amount === undefined || amount === null || amount === "" ? entry.amount : round2(amount);
    if (!(qty > 0)) throw httpError(400, "Količina mora biti veća od nule.");

    const author = await entryAuthor(entry);
    const usedRecords: Types.ObjectId[] = [];
    const specItems: Types.ObjectId[] = [];
    let charged = 0;
    let specificationId: Types.ObjectId | null = null;
    const messages: string[] = [];

    if (entry.type === "medicine" || entry.type === "article") {
      const itemId = entry.type === "medicine" ? entry.medicine : entry.article;
      // U period u koji pada dan kad je dato (npr. period specifikacije, ako je istekao)
      const res = await consumeForPatient(entry.type, { patientId: entry.patient, itemId: String(itemId), amount: qty, user, performedBy: author, at: entry.performedAt, specificationId: targetSpecificationId });
      usedRecords.push(res.usedRecord._id);
      specificationId = res.specification._id;
      charged = round2(res.homeUsed * (Number(res.usedRecord.priceAtTheTime) || 0));
      messages.push(res.message);
    } else {
      const task = await CareTask.findById(entry.careTask);
      if (!task) throw httpError(404, "Usluga više ne postoji u katalogu.");
      // Proverava se pre bilo kakve izmene, da artikal ne bude skinut ako specifikacije nema
      const spec = await resolveTargetSpecification(entry.patient, { at: entry.performedAt, specificationId: targetSpecificationId });
      specificationId = spec._id;

      // Prvo cena usluge (lako se povlači), pa artikal; ako artikla nema dovoljno,
      // naplata usluge se povlači i unos ostaje na čekanju — nema polovične naplate.
      // Usluga ide u specifikaciju ako ima cenu ili ako ne troši artikal (nega bez cene: 0 RSD,
      // uprava upisuje cenu u specifikaciji); usluga koja samo troši artikal naplaćuje artikal
      const hasArticle = !!task.article && task.articleAmount > 0;
      if (task.price > 0 || !hasArticle) {
        const res = await addServiceCharge(spec, { name: task.name, times: qty, unitPrice: task.price, createdBy: author._id });
        specItems.push(res.itemId);
        charged += res.price;
        messages.push("Usluga je dodata u specifikaciju.");
      }
      if (hasArticle) {
        try {
          const res = await consumeForPatient("article", {
            patientId: entry.patient,
            itemId: String(task.article),
            amount: round2(qty * task.articleAmount),
            user,
            performedBy: author,
            specificationId: spec._id,
          });
          usedRecords.push(res.usedRecord._id);
          charged += round2(res.homeUsed * (Number(res.usedRecord.priceAtTheTime) || 0));
          messages.push(res.message);
        } catch (err) {
          for (const itemId of specItems) await removeSpecItem(spec._id, itemId).catch(() => {});
          throw err;
        }
      }
    }

    const saved = await NurseEntry.findOneAndUpdate(
      { _id: entry._id },
      {
        $set: {
          status: "accepted",
          reviewedBy: user._id,
          reviewedAt: new Date(),
          acceptedAmount: qty,
          chargedPrice: round2(charged),
          specification: specificationId,
          usedRecords,
          specItems,
          rejectReason: "",
        },
      },
      { new: true }
    );
    return { id, ok: true, message: messages.join(" ") || "Prihvaćeno.", entry: saved! };
  } catch (err) {
    await release();
    throw err;
  }
}

async function entryAuthor(entry: NurseEntryDoc) {
  const author = await User.findById(entry.createdBy, { role: 1 });
  return { _id: entry.createdBy, role: author?.role ?? "nurse" };
}

/** Više unosa odjednom; svaki se obrađuje zasebno i vraća svoj ishod. */
export async function acceptMany(items: Array<{ id: unknown; amount?: unknown }>, user: Actor) {
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, "Nema izabranih unosa.");
  if (items.length > 200) throw httpError(400, "Previše unosa odjednom.");
  const results: AcceptResult[] = [];
  for (const { id, amount } of items) {
    try {
      results.push(await acceptEntry(id, user, amount));
    } catch (err) {
      results.push({ id: String(id), ok: false, message: (err as Error).message });
    }
  }
  return results;
}

export async function rejectEntry(entryId: unknown, user: Actor, reason?: unknown) {
  const updated = await NurseEntry.findOneAndUpdate(
    { _id: entryId, status: "pending" },
    {
      $set: {
        status: "rejected",
        reviewedBy: user._id,
        reviewedAt: new Date(),
        rejectReason: typeof reason === "string" ? reason.trim().slice(0, 300) : "",
      },
    },
    { new: true }
  ).catch(() => null);
  if (updated) return updated;
  const existing = await NurseEntry.findById(String(entryId)).catch(() => null);
  if (!existing) throw httpError(404, "Unos nije pronađen.");
  throw httpError(409, "Odbiti se može samo unos koji čeka odobrenje.");
}

/** Autor (ili uprava) povlači unos dok još nije obrađen. */
export async function cancelEntry(entryId: unknown, user: Actor) {
  const entry = await NurseEntry.findById(String(entryId)).catch(() => null);
  if (!entry) throw httpError(404, "Unos nije pronađen.");
  if (!isManagerRole(user.role) && String(entry.createdBy) !== String(user._id)) {
    throw httpError(403, "Možete da povučete samo svoje unose.");
  }
  if (entry.status !== "pending" && entry.status !== "logged") {
    throw httpError(409, "Unos je već obrađen i ne može se povući.");
  }
  const res = await NurseEntry.deleteOne({ _id: entry._id, status: { $in: ["pending", "logged"] } });
  if (res.deletedCount === 0) throw httpError(409, "Unos je upravo obrađen.");
}
