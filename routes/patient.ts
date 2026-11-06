import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js"
import {addPatient, getPatients, getPatient, deletePatient, dischargePatient} from "../controllers/patientController.js"

const router = express.Router()


router.post("/addPatient",authMiddleware, addPatient)
router.get("/",authMiddleware, getPatients)
router.get("/:id",authMiddleware, getPatient)
router.delete("/:id",authMiddleware, deletePatient)
// Otpust zatvara specifikaciju — samo uprava
router.patch("/:id/discharge", authMiddleware, requireManager, dischargePatient);

  


export default router