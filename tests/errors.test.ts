// Poruke grešaka ka klijentu: naše poruke prolaze, interni detalji ne.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, GENERIC_ERROR, httpError, statusOf } from "../utils/errors.js";

describe("errorMessage / statusOf", () => {
  test("naša greška (httpError) prolazi sa porukom i statusom, i 503", () => {
    assert.equal(errorMessage(httpError(409, "Period je zauzet.")), "Period je zauzet.");
    assert.equal(errorMessage(httpError(503, "Slanje mejlova nije podešeno.")), "Slanje mejlova nije podešeno.");
    assert.equal(statusOf(httpError(409, "x")), 409);
  });

  test("neočekivana greška: opšta poruka i 500, bez detalja baze", () => {
    const err = new Error("MongoServerError: connection to 10.0.0.12:27017 closed");
    assert.equal(errorMessage(err), GENERIC_ERROR);
    assert.equal(statusOf(err), 500);
  });

  test("neispravan ID ili podaci iz Mongoose-a: 400 i kratka poruka", () => {
    const cast = Object.assign(new Error('Cast to ObjectId failed for value "x" (type string) at path "_id"'), { name: "CastError" });
    assert.equal(errorMessage(cast), "Neispravan identifikator.");
    assert.equal(statusOf(cast), 400);
  });
});
