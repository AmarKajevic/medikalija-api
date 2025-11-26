import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { getNurseActions } from "../controllers/nurseActionsController.js"

const router = express.Router()

router.get("/",authMiddleware, getNurseActions)

export default router