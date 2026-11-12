import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js"
import {getDuplicatePatients, removeDuplicatePatients, addPatient, getPatients, getPatient, updatePatient, deletePatient, dischargePatient} from "../controllers/patientController.js"

const router = express.Router()


router.post("/addPatient",authMiddleware, addPatient)
router.get("/",authMiddleware, getPatients)
// Duplikati (isto ime i prezime) — pre "/:id"
router.get("/duplicates", authMiddleware, getDuplicatePatients)
router.post("/duplicates/remove", authMiddleware, removeDuplicatePatients)
router.get("/:id",authMiddleware, getPatient)
// Ispravka podataka — samo uprava
router.put("/:id", authMiddleware, requireManager, updatePatient)
router.delete("/:id",authMiddleware, deletePatient)
// Otpust zatvara specifikaciju — samo uprava
router.patch("/:id/discharge", authMiddleware, requireManager, dischargePatient);

  


export default router