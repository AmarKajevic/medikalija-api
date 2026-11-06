import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js"
import { getExchangeRates, updateExchangeRates } from "../controllers/exchangeRateController.js"

const router = express.Router()

router.get("/", authMiddleware, getExchangeRates)
// Kurs važi za sve pacijente — menja ga samo uprava
router.put("/", authMiddleware, requireManager, updateExchangeRates)

export default router;
