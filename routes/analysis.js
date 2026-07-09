import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { addAnalysis, addAnalysisToPatient, assignCombinationToPatient, deleteAnalysis, getAnalyses, getPatientAnalyses, updateAnalysis,getAssignedCombinations, addCombination, getCombinations, getAnalysis } from "../controllers/analysisController.js"

const router = express.Router()

router.post("/", authMiddleware,addAnalysis)
router.put("/:analysisId", authMiddleware,updateAnalysis)
router.get("/:analysisId", authMiddleware,getAnalysis)
router.delete("/:analysisId", authMiddleware, deleteAnalysis);
router.get("/", authMiddleware, getAnalyses);

router.post("/patient", authMiddleware, addAnalysisToPatient);
router.get("/patient/:patientId", authMiddleware, getPatientAnalyses);
router.post("/patient/:patientId/assign-combination", authMiddleware, assignCombinationToPatient);
router.get("/patient/:patientId/assigned-combination", authMiddleware, getAssignedCombinations);
router.post("/combination/addCombination", authMiddleware, addCombination);
router.get("/combination/get", authMiddleware, getCombinations);


export default router