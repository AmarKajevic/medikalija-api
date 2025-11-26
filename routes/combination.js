import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { addCombination, addCombinationToPatient, getCombinations, getPatientCombinations, getUsedCombination } from "../controllers/combinationController.js"
import UsedCombinations from "../models/UsedCombinations.js"

const router = express.Router()

router.post("/add",authMiddleware, addCombination)
router.get("/",authMiddleware, getCombinations)
router.get("/:patientId",authMiddleware, getUsedCombination)
router.post("/addToPatient/:patientId",authMiddleware, addCombinationToPatient)
router.get("/combinations/:patientId", authMiddleware, getPatientCombinations)
router.delete("/patient/:patientId/combinations/delete-all",authMiddleware, async (req, res) => {
    try {
        await UsedCombinations.deleteMany({ patient: req.params.patientId });
         res.json({ success: true });
    } catch (error) {
        console.error("Greška:", err);
      res.status(500).json({ success: false });
    }
  
});


export default router