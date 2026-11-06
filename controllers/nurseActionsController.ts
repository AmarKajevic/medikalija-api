import type { Request, Response } from "express";
import { isManagerRole } from "../middleware/requireRole.js";
import { loadActivity } from "../services/activityFeed.js";

// Svi unosi medicinskih sestara (dijagnoze, artikli, lekovi), najnoviji prvi.
export const getNurseActions = async (req: Request, res: Response) => {
  try {
    if (!isManagerRole(req.user.role)) {
      return res.status(403).json({ success: false, message: "Nedovoljno privilegija" });
    }

    const nurseActions = await loadActivity({ role: "nurse" });
    return res.status(200).json({ success: true, nurseActions });
  } catch (error) {
    console.error("getNurseActions:", error);
    return res.status(500).json({ success: false, message: "Greška na serveru" });
  }
};
