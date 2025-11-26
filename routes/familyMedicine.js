import express from "express";
import { addFamilyMedicine, deleteFamilyMedicine, getFamilyMedicine, getFamilyMedicines, updateFamilyMedicine } from "../controllers/familyMedicineController.js";
import authMiddleware from "../middleware/authMiddleware.js";


const router = express.Router();

router.get("/:familyMedicineId", authMiddleware, getFamilyMedicine)
router.get("/", authMiddleware, getFamilyMedicines)
router.post("/",authMiddleware, addFamilyMedicine)
router.put("/:familyMedicineId",authMiddleware, updateFamilyMedicine)
router.delete("/:familyMedicineId",authMiddleware, deleteFamilyMedicine)


export default router;