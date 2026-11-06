import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { activatePeriod, activateNextPeriod, activateExisting, addCostsToSpecification, calculatePreview, deleteSpecificationItem, getFutureSpecificationPeriods, getSpecification, getSpecificationById, getSpecificationHistory, saveBillingForSpecification } from "../controllers/specificationController.js"

const router = express.Router()


router.get("/:patientId", authMiddleware, getSpecification)
router.post("/:patientId/activate", authMiddleware, activatePeriod)
router.post("/:patientId/activate-next", authMiddleware, activateNextPeriod)
router.post("/:patientId/activate/:specId", authMiddleware, activateExisting)
router.get("/history/:patientId", authMiddleware, getSpecificationHistory)
router.get("/view/:id", authMiddleware, getSpecificationById)
router.get("/:patientId/future-spec-periods", authMiddleware, getFutureSpecificationPeriods);
router.post("/:id/billing", authMiddleware, saveBillingForSpecification);
router.post("/:id/add-costs", authMiddleware, addCostsToSpecification);
router.post("/calculate-preview", authMiddleware, calculatePreview)
router.delete(
  "/:specId/item/:itemId",
  authMiddleware,
  deleteSpecificationItem
);


export default router

