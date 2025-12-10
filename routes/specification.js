import express from "express" 
import authMiddleware from "../middleware/authMiddleware.js"
import { addCostsToSpecification, deleteSpecificationItem, getSpecification, getSpecificationById, getSpecificationHistory, saveBillingForSpecification } from "../controllers/specificationController.js"
import { getFutureSpecificationPeriods } from "../services/getOrCreateActiveSpecification.js"

const router = express.Router()


router.get("/:patientId", authMiddleware, getSpecification)
router.get("/history/:patientId", authMiddleware, getSpecificationHistory)
router.get("/view/:id", authMiddleware, getSpecificationById)
router.get("/:patientId/future-spec-periods", getFutureSpecificationPeriods);
router.post("/:id/billing", authMiddleware, saveBillingForSpecification);
router.post("/:id/add-costs", authMiddleware, addCostsToSpecification);
router.delete(
  "/:specId/item/:itemId",
  authMiddleware,
  deleteSpecificationItem
);


export default router

