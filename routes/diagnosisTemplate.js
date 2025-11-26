import express from "express";
import { addDiagnosisTemplate, getDiagnosisTemplate } from "../controllers/diagnosisTemplateController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = new express.Router();

router.post("/add",authMiddleware, addDiagnosisTemplate)
router.get("/",authMiddleware, getDiagnosisTemplate)

export default router