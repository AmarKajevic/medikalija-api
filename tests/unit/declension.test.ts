// Padeži u obrascima: lična imena i mesta (pravopis srpskog jezika).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { addressLocative, declinePerson, declinePlace } from "../../services/social/declension.js";

describe("padeži ličnih imena", () => {
  test("žensko ime na -a se menja, žensko prezime na suglasnik ne", () => {
    assert.equal(declinePerson("Milica", "Jovanović", "Ž", "acc"), "Milicu Jovanović");
    assert.equal(declinePerson("Milica", "Jovanović", "Ž", "dat"), "Milici Jovanović");
    assert.equal(declinePerson("Milica", "Jovanović", "Ž", "gen"), "Milice Jovanović");
    assert.equal(declinePerson("Marija", "Ilić", "Ž", "gen"), "Marije Ilić");
    assert.equal(declinePerson("Milka", "Petrović", "Ž", "dat"), "Milki Petrović", "lična imena bez sibilarizacije");
  });

  test("muško ime i prezime: suglasnik, -o, -e, -a i nepostojano a", () => {
    assert.equal(declinePerson("Petar", "Petrović", "M", "gen"), "Petra Petrovića");
    assert.equal(declinePerson("Petar", "Petrović", "M", "dat"), "Petru Petroviću");
    assert.equal(declinePerson("Aleksandar", "Nikolić", "M", "acc"), "Aleksandra Nikolića");
    assert.equal(declinePerson("Stevan", "Jovanović", "M", "acc"), "Stevana Jovanovića");
    assert.equal(declinePerson("Marko", "Marković", "M", "dat"), "Marku Markoviću");
    assert.equal(declinePerson("Đorđe", "Lazić", "M", "gen"), "Đorđa Lazića");
    assert.equal(declinePerson("Nikola", "Tesla", "M", "dat"), "Nikoli Tesli");
    assert.equal(declinePerson("Ilija", "Stanac", "M", "gen"), "Ilije Stanca");
    assert.equal(declinePerson("Lazar", "Kovač", "M", "gen"), "Lazara Kovača", "Lazar nema nepostojano a");
  });

  test("posebni slučajevi: bez pola, pridevsko žensko prezime, dvostruko prezime, velika slova", () => {
    assert.equal(declinePerson("Ana", "Kovačevska", "Ž", "dat"), "Ani Kovačevskoj");
    assert.equal(declinePerson("Milica", "Jovanović-Ilić", "Ž", "acc"), "Milicu Jovanović-Ilić");
    assert.equal(declinePerson("Petar", "Petrović-Njegoš", "M", "gen"), "Petra Petrovića-Njegoša");
    assert.equal(declinePerson("MILICA", "JOVANOVIĆ", "Ž", "acc"), "MILICU JOVANOVIĆ");
    // Bez pola: imena na -a se menjaju, a prezime na suglasnik kao muško (najčešći slučaj u obrascima)
    assert.equal(declinePerson("Milica", "Jovanović", "", "dat"), "Milici Jovanoviću");
  });
});

describe("padeži mesta", () => {
  test("genitiv (iz …) i lokativ (u …)", () => {
    assert.equal(declinePlace("Beograd", "gen"), "Beograda");
    assert.equal(declinePlace("Beograd", "loc"), "Beogradu");
    assert.equal(declinePlace("Novi Sad", "gen"), "Novog Sada");
    assert.equal(declinePlace("Novi Sad", "loc"), "Novom Sadu");
    assert.equal(declinePlace("Kragujevac", "gen"), "Kragujevca");
    assert.equal(declinePlace("Voždovac", "gen"), "Voždovca");
    assert.equal(declinePlace("Čačak", "loc"), "Čačku");
    assert.equal(declinePlace("Pančevo", "gen"), "Pančeva");
    assert.equal(declinePlace("Sremska Mitrovica", "loc"), "Sremskoj Mitrovici");
    assert.equal(declinePlace("Gornji Milanovac", "gen"), "Gornjeg Milanovca");
  });

  test("adresa: menja se samo mesto; ulica sa brojem ostaje", () => {
    assert.equal(addressLocative("Beograd, Vojvode Stepe 12"), "Beogradu, Vojvode Stepe 12");
    assert.equal(addressLocative("Novi Sad, Bulevar oslobođenja 5"), "Novom Sadu, Bulevar oslobođenja 5");
    assert.equal(addressLocative("Vojvode Stepe 12"), "Vojvode Stepe 12");
  });
});
