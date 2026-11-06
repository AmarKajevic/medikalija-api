import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager } from "../middleware/requireRole.js";
import { addAnalysis, deleteAnalysis, getAnalyses, getAnalysis, updateAnalysis } from "../controllers/analysisController.js";

const router = express.Router();

router.get("/", authMiddleware, getAnalyses);
router.get("/:analysisId", authMiddleware, getAnalysis);
router.post("/", authMiddleware, requireManager, addAnalysis);
router.put("/:analysisId", authMiddleware, requireManager, updateAnalysis);
router.delete("/:analysisId", authMiddleware, requireManager, deleteAnalysis);

export default router;
