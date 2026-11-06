import express from "express"
import type { Request, Response } from "express";
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js";
import { addCombination, addCombinationToPatient, deleteCombination, getPatientCombinations } from "../controllers/combinationController.js"
import UsedCombinations from "../models/UsedCombinations.js"
import { param } from "../utils/http.js";

const router = express.Router()

router.post("/add",authMiddleware, requireManager, addCombination)
router.post("/addToPatient/:patientId",authMiddleware, addCombinationToPatient)
router.get("/combinations/:patientId", authMiddleware, getPatientCombinations)
router.delete("/combinations/:id",authMiddleware, requireManager, deleteCombination);
router.delete("/patient/:patientId/combinations/delete-all",authMiddleware, requireManager, async (req: Request, res: Response) => {
    try {
        await UsedCombinations.deleteMany({ patient: param(req, "patientId") });
         res.json({ success: true });
    } catch (error) {
        console.error("Greška:", error);
      res.status(500).json({ success: false });
    }
  
});


export default router