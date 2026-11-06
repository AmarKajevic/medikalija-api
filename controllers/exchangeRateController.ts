// controllers/exchangeRateController.js
import GlobalSetting from '../models/GlobalSetting.js';
import type { Request, Response } from "express";
import { errorMessage } from "../utils/errors.js";

export const getExchangeRates = async (_req: Request, res: Response) => {
  try {
    let settings = await GlobalSetting.findOne();
    if (!settings) {
      // inicijalno, ako ne postoji, kreiraj sa default vrednostima
      settings = await GlobalSetting.create({ lowerExchangeRate: 117.2, middleExchangeRate: 117.75 });
    }
    res.json({ success: true, rates: { lower: settings.lowerExchangeRate, middle: settings.middleExchangeRate } });
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
};

export const updateExchangeRates = async (req: Request, res: Response) => {
  try {
    const { lowerExchangeRate, middleExchangeRate } = req.body ?? {};
    const invalid = [lowerExchangeRate, middleExchangeRate].some(
      (v) => v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= 0)
    );
    if (invalid) return res.status(400).json({ success: false, message: "Kurs mora biti pozitivan broj." });
    let settings = await GlobalSetting.findOne();
    if (!settings) {
      settings = new GlobalSetting();
    }
    if (lowerExchangeRate !== undefined) settings.lowerExchangeRate = lowerExchangeRate;
    if (middleExchangeRate !== undefined) settings.middleExchangeRate = middleExchangeRate;
    settings.updatedBy = req.user._id;
    await settings.save();
    res.json({ success: true, rates: { lower: settings.lowerExchangeRate, middle: settings.middleExchangeRate } });
  } catch (err) {
    res.status(500).json({ success: false, message: errorMessage(err) });
  }
};