import express from "express"
import { addMedicine, deleteMedicine, getMedicine, getMedicines, getPatientMedicine, updateMedicine, useMedicine,getPatientStockMedicines } from "../controllers/medicineController.js"
import authMiddleware from "../middleware/authMiddleware.js"
import UsedMedicine from "../models/UsedMedicine.js"

const router = express.Router()

router.post ("/add",authMiddleware, addMedicine)
router.post ("/use",authMiddleware, useMedicine)
router.get ("/",authMiddleware, getMedicines)
router.get ("/:medicineId",authMiddleware, getMedicine)
router.put ("/:medicineId",authMiddleware, updateMedicine)
router.delete ("/:medicineId",authMiddleware, deleteMedicine)

router.get(
  "/patient/:patientId/medicines",
  authMiddleware,
  getPatientMedicine
);

router.get(
  "/patient/:patientId/stock",
  authMiddleware,
  getPatientStockMedicines
);

router.delete(
  "/patient/:patientId/medicines/delete-all",
  authMiddleware,
  async (req, res) => {

    console.log("DELETE LEKOVI HIT! Patient:", req.params.patientId);

    try {
      await UsedMedicine.deleteMany({ patient: req.params.patientId });
      res.json({ success: true });
    } catch (err) {
      console.error("Greška:", err);
      res.status(500).json({ success: false });
    }
  }
);




export default router

