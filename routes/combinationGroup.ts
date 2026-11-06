import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { addCombinationToGroup, deleteGroup, getGroups } from "../controllers/combinationGroupController.js"


import { requireManager } from "../middleware/requireRole.js"

const router = express.Router()

router.post("/", authMiddleware, requireManager, addCombinationToGroup)
router.get("/", authMiddleware, getGroups)
// combination groups routes
router.delete("/combination-groups/:id", authMiddleware, requireManager, deleteGroup);



export default router