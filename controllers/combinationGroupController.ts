import type { Request, Response } from "express";
import type { Types } from "mongoose";
import Combination from "../models/Combination.js";
import CombinationGroup from "../models/CombinationGroup.js";
import type { PricedRef } from "../models/populated.js";
import { errorMessage } from "../utils/errors.js";
import { param } from "../utils/http.js";

// Grupe kombinacija analiza ("Laboratorija", "Biohemija"...). U grupi se čuvaju
// samo ID-jevi analiza; cene se uvek čitaju iz šifarnika pri prikazu.

const addCombinationToGroup = async (req: Request, res: Response) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    const ids: unknown = req.body.combinations;
    if (!name || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "Naziv grupe i kombinacije su obavezni." });
    }

    const combs = await Combination.find({ _id: { $in: ids } });
    if (combs.length === 0) {
      return res.status(404).json({ success: false, message: "Nijedna kombinacija nije pronađena." });
    }

    const entries = combs.map((c) => ({ _id: c._id, name: c.name, totalPrice: c.totalPrice, analyses: c.analyses }));

    const existing = await CombinationGroup.findOne({ name });
    if (existing) {
      existing.combinations.push(...entries);
      await existing.save();
      return res.status(200).json({ success: true, message: "Kombinacije dodate u postojeću grupu", group: existing });
    }

    const group = await CombinationGroup.create({ name, combinations: entries, createdBy: req.user._id });
    return res.status(201).json({ success: true, group });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

interface PopulatedGroupCombination {
  _id: Types.ObjectId;
  name: string;
  totalPrice?: number | null;
  analyses: PricedRef[];
}

const getGroups = async (_req: Request, res: Response) => {
  try {
    const groups = await CombinationGroup.find().populate<{ combinations: PopulatedGroupCombination[] }>({
      path: "combinations.analyses",
      model: "Analysis",
    });

    const formatted = groups.map((g) => ({
      _id: g._id,
      name: g.name,
      combinations: (g.combinations ?? []).map((c) => {
        // Analiza obrisana iz šifarnika ostaje kao null posle populate — preskače se
        const analyses = (c.analyses ?? []).filter((a): a is PricedRef => !!a && typeof a === "object" && "name" in a);
        const totalPrice = analyses.reduce((sum, a) => sum + (a.price || 0), 0);
        return {
          _id: c._id,
          name: c.name,
          totalPrice,
          analyses: analyses.map((a) => ({ totalPrice, _id: a._id, name: a.name, price: a.price })),
        };
      }),
    }));

    return res.status(200).json({ success: true, groups: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

const deleteGroup = async (req: Request, res: Response) => {
  try {
    const deleted = await CombinationGroup.findByIdAndDelete(param(req, "id"));
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Grupa nije pronađena" });
    }
    return res.status(200).json({ success: true, message: "Grupa uspešno obrisana" });
  } catch (error) {
    return res.status(500).json({ success: false, message: errorMessage(error) });
  }
};

export { addCombinationToGroup, getGroups, deleteGroup };
