import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { getExchangeRates, updateExchangeRates } from "../controllers/exchangeRateController.js"

const router = express.Router()

router.get("/", authMiddleware, getExchangeRates)
router.put("/", authMiddleware, updateExchangeRates)

export default router;