import type { Request, Response } from "express";
import mongoose from "mongoose";
import { errorMessage, statusOf } from "../utils/errors.js";
import { loadStaffActivity } from "../services/staffActivity.js";

const MAX_DAYS = 366;

// GET /api/activity?from=ISO&to=ISO&userId=  → šta je ko od osoblja dodao (uprava)
export const listActivity = async (req: Request, res: Response) => {
  try {
    const { from, to, userId } = req.query as Record<string, string | undefined>;
    const toDate = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : new Date();
    const fromDate = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(toDate.getTime() - 30 * 86_400_000);
    if (fromDate >= toDate) return res.status(400).json({ success: false, message: "Početak mora biti pre kraja." });
    if (toDate.getTime() - fromDate.getTime() > MAX_DAYS * 86_400_000) {
      return res.status(400).json({ success: false, message: "Izaberite period do godinu dana." });
    }
    if (userId && !mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, message: "Neispravan korisnik." });

    const activity = await loadStaffActivity({ from: fromDate, to: toDate, userId, limit: 2000 });
    res.json({ success: true, from: fromDate, to: toDate, activity });
  } catch (err) {
    res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });
  }
};
