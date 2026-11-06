import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireClinical, requireRole } from "../middleware/requireRole.js";
import { addAddendum, createReport, deleteReport, getReport, listReports, signReport, updateReport } from "../controllers/medicalReportController.js";

const router = express.Router();
const doctor = requireRole("doctor");

// Čita zdravstveno osoblje (sestre zbog terapije); piše i potpisuje samo doktor
router.use(authMiddleware, requireClinical);

router.get("/", listReports);
router.get("/:id", getReport);
router.post("/", doctor, createReport);
router.put("/:id", doctor, updateReport);
router.post("/:id/sign", doctor, signReport);
router.post("/:id/addenda", doctor, addAddendum);
router.delete("/:id", doctor, deleteReport);

export default router;
