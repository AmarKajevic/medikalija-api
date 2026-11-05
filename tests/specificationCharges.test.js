// Integracioni testovi nad pravom (privremenom, in-memory) MongoDB bazom.
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import Patient from "../models/Patient.js";
import Medicine from "../models/Medicine.js";
import Article from "../models/Articles.js";
import PatientMedicine from "../models/PatientMedicine.js";
import UsedMedicine from "../models/UsedMedicine.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedCombinations from "../models/UsedCombinations.js";
import Specification from "../models/Specification.js";
import Analysis from "../models/Analysis.js";
import Combination from "../models/Combination.js";
import {
  addCombinationCharge,
  addExtraCharge,
  consumeForPatient,
  removeSpecItem,
} from "../services/specificationCharges.js";
import { getActiveSpecification } from "../services/getOrCreateActiveSpecification.js";

let mongo;
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };
const nurse = { _id: new mongoose.Types.ObjectId(), role: "nurse" };

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

let patient;
let medicine;

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  await Promise.all(mongoose.modelNames().map((m) => mongoose.model(m).syncIndexes()));

  patient = await Patient.create({
    name: "Petar",
    lastName: "Petrović",
    dateOfBirth: new Date("1940-01-01T00:00:00Z"),
    address: "Beograd",
    admissionDate: new Date(Date.now() - 5 * 86400000),
  });
  medicine = await Medicine.create({ name: "Andol", pricePerUnit: 100, quantity: 10, unitsPerPackage: 5, packageCount: 2 });
});

const use = (amount, user = admin, itemId = medicine._id) =>
  consumeForPatient("medicine", { patientId: patient._id, itemId, amount, user });

describe("davanje leka", () => {
  test("prvo porodično stanje, naplaćuje se samo deo sa stanja doma", async () => {
    await PatientMedicine.create({ patient: patient._id, medicine: medicine._id, quantity: 2 });

    const res = await use(5);

    assert.equal(res.familyUsed, 2);
    assert.equal(res.homeUsed, 3);
    const item = res.specification.items[0];
    assert.equal(item.amount, 3);
    assert.equal(item.price, 300);
    assert.equal(res.specification.totalPrice, 300);
    assert.equal(String(item.medicine), String(medicine._id));

    const med = await Medicine.findById(medicine._id);
    assert.equal(med.quantity, 7);
    assert.equal(med.packageCount, 1);
    assert.equal((await PatientMedicine.findOne({ patient: patient._id })).quantity, 0);

    const used = await UsedMedicine.findById(res.usedRecord._id);
    assert.equal(used.familyAmount, 2);
    assert.equal(used.homeAmount, 3);
  });

  test("nedovoljno na stanju: greška i NIŠTA se ne menja (ni porodično stanje)", async () => {
    await PatientMedicine.create({ patient: patient._id, medicine: medicine._id, quantity: 2 });

    await assert.rejects(use(20), (e) => e.status === 400);

    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
    assert.equal((await PatientMedicine.findOne({ patient: patient._id })).quantity, 2);
    assert.equal(await UsedMedicine.countDocuments(), 0);
  });

  test("otpušten pacijent: 409, stanje netaknuto", async () => {
    await Patient.updateOne({ _id: patient._id }, { dischargeDate: new Date() });

    await assert.rejects(use(1), (e) => e.status === 409);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
    assert.equal(await UsedMedicine.countDocuments(), 0);
  });

  test("sestra samo beleži, bez promene stanja i specifikacije", async () => {
    const res = await use(3, nurse);
    assert.equal(res.homeUsed, 0);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
    assert.equal((await getActiveSpecification(patient._id)).items.length, 0);
    assert.equal(await UsedMedicine.countDocuments({ roleUsed: "nurse" }), 1);
  });

  test("ponovljeno davanje se spaja u jednu stavku", async () => {
    await use(1);
    const res = await use(2);
    assert.equal(res.specification.items.length, 1);
    assert.equal(res.specification.items[0].amount, 3);
    assert.equal(res.specification.items[0].entries.length, 2);
  });

  test("lek bez cene ne kvari ukupan iznos (0, ne NaN)", async () => {
    const free = await Medicine.create({ name: "Bez cene", quantity: 5 });
    const res = await use(1, admin, free._id);
    assert.equal(res.specification.totalPrice, 0);
  });

  test("decimalne količine (1/3 tablete) ne prave grešku zaokruživanja", async () => {
    await Medicine.updateOne({ _id: medicine._id }, { quantity: 1 });
    await use(0.33);
    await use(0.33);
    await use(0.34);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 0);
  });

  test("istovremena davanja ne mogu da odu u minus", async () => {
    await Medicine.updateOne({ _id: medicine._id }, { quantity: 3 });

    const results = await Promise.allSettled(Array.from({ length: 6 }, () => use(1)));
    const ok = results.filter((r) => r.status === "fulfilled").length;

    assert.equal(ok, 3);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 0);
    const spec = await getActiveSpecification(patient._id);
    assert.equal(spec.items[0].amount, 3);
    assert.equal(spec.totalPrice, 300);
    assert.equal(await UsedMedicine.countDocuments(), 3);
  });
});

describe("artikli", () => {
  test("rade po istim pravilima kao lekovi", async () => {
    const article = await Article.create({ name: "Pelene", price: 50, quantity: 4 });
    const res = await consumeForPatient("article", { patientId: patient._id, itemId: article._id, amount: 2, user: admin });
    assert.equal(res.specification.items[0].category, "articles");
    assert.equal(res.specification.totalPrice, 100);
    assert.equal((await Article.findById(article._id)).quantity, 2);
    assert.equal(await UsedArticles.countDocuments(), 1);
  });
});

describe("ukupan iznos i dodatni troškovi", () => {
  test("dodatni trošak se ne broji dva puta kad se posle doda lek", async () => {
    const spec = await getActiveSpecification(patient._id);
    await addExtraCharge(spec, { label: "Frizer", amount: 500, user: admin });

    const res = await use(1);

    assert.equal(res.specification.totalPrice, 600);
    assert.equal(res.specification.extraCosts, 500);
  });

  test("istovremene izmene iste specifikacije se ne gube", async () => {
    const analysis = await Analysis.create({ name: "KKS", price: 200, createdBy: admin._id });
    const combination = await Combination.create({ name: "Osnovna", analyses: [analysis._id] });
    const populated = await Combination.findById(combination._id).populate("analyses", "name price");

    await Promise.all(
      Array.from({ length: 5 }, () => addCombinationCharge({ patientId: patient._id, combination: populated, user: admin }))
    );

    const spec = await getActiveSpecification(patient._id);
    assert.equal(spec.items.length, 1);
    assert.equal(spec.items[0].amount, 5);
    assert.equal(spec.totalPrice, 1000);
    assert.equal(await UsedCombinations.countDocuments(), 5);
  });
});

describe("brisanje stavke", () => {
  test("vraća stanje doma i porodično stanje i briše zapise o potrošnji", async () => {
    await PatientMedicine.create({ patient: patient._id, medicine: medicine._id, quantity: 2 });
    await use(5);
    const spec = await getActiveSpecification(patient._id);
    await addExtraCharge(spec, { label: "Prevoz", amount: 150, user: admin });
    const fresh = await getActiveSpecification(patient._id);
    const medItem = fresh.items.find((i) => i.category === "medicine");

    const res = await removeSpecItem(fresh._id, medItem._id);

    assert.equal(res.fullyReverted, true);
    assert.equal(res.specification.items.length, 1);
    assert.equal(res.specification.totalPrice, 150);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
    assert.equal((await Medicine.findById(medicine._id)).packageCount, 2);
    assert.equal((await PatientMedicine.findOne({ patient: patient._id })).quantity, 2);
    assert.equal(await UsedMedicine.countDocuments(), 0);
  });

  test("stara stavka bez zapisa: uklanja se trošak, stanje se ne dira", async () => {
    const spec = await getActiveSpecification(patient._id);
    spec.items.push({ name: "Andol", category: "medicine", amount: 2, price: 200 });
    spec.totalPrice = 200;
    await spec.save();

    const res = await removeSpecItem(spec._id, spec.items[0]._id);

    assert.equal(res.fullyReverted, false);
    assert.equal(res.specification.totalPrice, 0);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
  });

  test("dvostruko brisanje iste stavke ne vraća stanje dva puta", async () => {
    await use(4);
    const spec = await getActiveSpecification(patient._id);
    const itemId = spec.items[0]._id;

    const results = await Promise.allSettled([removeSpecItem(spec._id, itemId), removeSpecItem(spec._id, itemId)]);

    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await Medicine.findById(medicine._id)).quantity, 10);
  });

  test("brisanje kombinacije briše i zapis o urađenoj kombinaciji", async () => {
    const analysis = await Analysis.create({ name: "CRP", price: 300, createdBy: admin._id });
    const combination = await Combination.create({ name: "Upala", analyses: [analysis._id] });
    const populated = await Combination.findById(combination._id).populate("analyses", "name price");
    const { specification } = await addCombinationCharge({ patientId: patient._id, combination: populated, user: admin });

    await removeSpecItem(specification._id, specification.items[0]._id);

    assert.equal(await UsedCombinations.countDocuments(), 0);
    assert.equal((await Specification.findById(specification._id)).totalPrice, 0);
  });
});
