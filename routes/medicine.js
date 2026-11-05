import express from "express"
import { addMedicine, deleteMedicine, getMedicine, getMedicines,
   getPatientMedicine, updateMedicine, useMedicine,
   getPatientStockMedicines,updatePatientMedicine , deletePatientMedicine} from "../controllers/medicineController.js"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager, requireManagerUnlessFamily } from "../middleware/requireRole.js"
import UsedMedicine from "../models/UsedMedicine.js"

const router = express.Router()


router.post ("/add",authMiddleware, requireManagerUnlessFamily, addMedicine)
router.post ("/use",authMiddleware, useMedicine)
router.get ("/",authMiddleware, getMedicines)

router.put("/:medicineId", authMiddleware, requireManager, updateMedicine);
router.delete ("/:medicineId",authMiddleware, requireManager, deleteMedicine)

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
router.get ("/:medicineId",authMiddleware, getMedicine)
router.put(
  "/patient-stock/:id",
  authMiddleware,
  requireManager,
  updatePatientMedicine
);
router.delete(
  "/patient-stock/:id",
  authMiddleware,
  requireManager,
  deletePatientMedicine
);

router.delete(
  "/patient/:patientId/medicines/delete-all",
  authMiddleware,
  requireManager,
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

