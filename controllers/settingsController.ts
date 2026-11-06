import type { Request, Response } from "express";
import GlobalSetting, { DEFAULT_FACILITY, FACILITY_FIELDS, type FacilityField } from "../models/GlobalSetting.js";
import { errorMessage } from "../utils/errors.js";

// Logo se čuva u bazi kao data URL (serverless nema trajni disk). Frontend ga
// pre slanja smanjuje; SVG nije dozvoljen jer može da nosi skriptu.
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const MAX_LOGO_LENGTH = 700_000;

const MAX_LENGTH: Partial<Record<FacilityField, number>> = { name: 80, subtitle: 120 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Facility = Record<FacilityField, string>;

const toFacility = (doc: { facility?: Partial<Facility> | null } | null): Facility =>
  Object.fromEntries(FACILITY_FIELDS.map((f) => [f, doc?.facility?.[f] ?? DEFAULT_FACILITY[f]])) as Facility;

/** Proverava izmene; vraća poruku o grešci ili null. */
function validate(changes: Partial<Facility>): string | null {
  if (changes.name !== undefined && !changes.name.trim()) return "Naziv ustanove je obavezan.";
  for (const f of FACILITY_FIELDS) {
    const v = changes[f];
    if (v === undefined || f === "logo") continue;
    if (v.length > (MAX_LENGTH[f] ?? 200)) return `Polje "${f}" je predugačko.`;
  }
  if (changes.email && !EMAIL_PATTERN.test(changes.email.trim())) return "E-mail adresa nije ispravna.";
  if (changes.logo) {
    if (changes.logo.length > MAX_LOGO_LENGTH) return "Logo je prevelik. Izaberite manju sliku.";
    if (!LOGO_PATTERN.test(changes.logo)) return "Logo mora biti PNG, JPG ili WebP slika.";
  }
  return null;
}

// Javno: naziv i logo se prikazuju i na stranici za prijavu.
export const getFacility = async (_req: Request, res: Response) => {
  try {
    const settings = await GlobalSetting.findOne().lean();
    res.json({ success: true, facility: toFacility(settings) });
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
};

export const updateFacility = async (req: Request, res: Response) => {
  try {
    const body: unknown = req.body;
    if (!body || typeof body !== "object") return res.status(400).json({ success: false, message: "Neispravan zahtev." });

    const changes: Partial<Facility> = {};
    for (const f of FACILITY_FIELDS) {
      const v = (body as Record<string, unknown>)[f];
      if (v === undefined) continue;
      if (typeof v !== "string") return res.status(400).json({ success: false, message: `Polje "${f}" mora biti tekst.` });
      changes[f] = f === "logo" ? v : v.trim();
    }

    const problem = validate(changes);
    if (problem) return res.status(400).json({ success: false, message: problem });

    const $set = Object.fromEntries(Object.entries(changes).map(([k, v]) => [`facility.${k}`, v]));
    const settings = await GlobalSetting.findOneAndUpdate(
      {},
      { $set: { ...$set, updatedBy: req.user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ success: true, facility: toFacility(settings) });
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
};
