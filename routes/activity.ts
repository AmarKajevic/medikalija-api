import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { requireManager } from "../middleware/requireRole.js"
import { listActivity } from "../controllers/activityController.js"

const router = express.Router()

// Aktivnosti osoblja: vidi samo uprava
router.get("/", authMiddleware, requireManager, listActivity)

export default router
