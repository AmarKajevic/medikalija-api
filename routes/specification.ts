import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js"
import { getNonStandardPeriods, openNonStandard, updateSpecificationItemAmount, getBillingPeriod, getPastPeriods, openPeriod, changeDates, activatePeriod, activateNextPeriod, activateExisting, addCostsToSpecification, calculatePreview, deleteSpecificationItem, getFutureSpecificationPeriods, getSpecification, getSpecificationById, getSpecificationHistory, saveBillingForSpecification } from "../controllers/specificationController.js"

const router = express.Router()


router.get("/:patientId", authMiddleware, getSpecification)
// Period specifikacije (pre aktivnog) — u njemu se uglavnom pravi obračun
router.get("/:patientId/billing-period", authMiddleware, requireManager, getBillingPeriod)
router.get("/:patientId/non-standard", authMiddleware, requireManager, getNonStandardPeriods)
router.post("/:patientId/non-standard", authMiddleware, requireManager, openNonStandard)
router.get("/:patientId/past-periods", authMiddleware, requireManager, getPastPeriods)
router.post("/:patientId/periods", authMiddleware, requireManager, openPeriod)
router.put("/:patientId/periods/:specId", authMiddleware, requireManager, changeDates)
router.post("/:patientId/activate", authMiddleware, activatePeriod)
router.post("/:patientId/activate-next", authMiddleware, activateNextPeriod)
router.post("/:patientId/activate/:specId", authMiddleware, activateExisting)
router.get("/history/:patientId", authMiddleware, getSpecificationHistory)
router.get("/view/:id", authMiddleware, getSpecificationById)
router.get("/:patientId/future-spec-periods", authMiddleware, getFutureSpecificationPeriods);
router.post("/:id/billing", authMiddleware, requireManager, saveBillingForSpecification);
router.post("/:id/add-costs", authMiddleware, addCostsToSpecification);
router.post("/calculate-preview", authMiddleware, calculatePreview)
router.patch("/:specId/item/:itemId", authMiddleware, requireManager, updateSpecificationItemAmount);
router.delete(
  "/:specId/item/:itemId",
  authMiddleware,
  deleteSpecificationItem
);


export default router

