import express from "express"
import type { Request, Response } from "express";
import {addDiagnosis, getDiagnosis} from "../controllers/diagnosisController.js"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js";
import Diagnosis from "../models/Diagnosis.js"
import { param } from "../utils/http.js";

const router = express.Router()

router.post("/addDiagnosis",authMiddleware, addDiagnosis)
router.get("/:patientId",authMiddleware, getDiagnosis)
router.delete("/patient/:patientId/diagnoses/delete-all",authMiddleware, requireManager, async (req: Request, res: Response) => {
    try {
        await Diagnosis.deleteMany({ patient: param(req, "patientId") });
        res.json({ success: true });
    } catch (error) {
        console.error("Greška:", error);
      res.status(500).json({ success: false });
    }
  
});



export default router