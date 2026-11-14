import express from "express";
import { addDiagnosisTemplate, deleteDiagnosisTemplate, getDiagnosisTemplate, updateDiagnosisTemplate } from "../controllers/diagnosisTemplateController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager } from "../middleware/requireRole.js";

const router = express.Router();

router.get("/", authMiddleware, getDiagnosisTemplate);
// Šablone pravi i menja uprava
router.post("/add", authMiddleware, requireManager, addDiagnosisTemplate);
router.put("/:id", authMiddleware, requireManager, updateDiagnosisTemplate);
router.delete("/:id", authMiddleware, requireManager, deleteDiagnosisTemplate);

export default router;
