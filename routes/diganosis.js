import express from "express"
import {addDiagnosis, getDiagnosis} from "../controllers/diagnosisController.js"
import authMiddleware from "../middleware/authMiddleware.js"
import Diagnosis from "../models/Diagnosis.js"

const router = express.Router()

router.post("/addDiagnosis",authMiddleware, addDiagnosis)
router.get("/:patientId",authMiddleware, getDiagnosis)
router.delete("/patient/:patientId/diagnoses/delete-all",authMiddleware, async (req, res) => {
    try {
        await Diagnosis.deleteMany({ patient: req.params.patientId });
        res.json({ success: true });
    } catch (error) {
        console.error("Greška:", err);
      res.status(500).json({ success: false });
    }
  
});



export default router