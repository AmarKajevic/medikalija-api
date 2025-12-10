import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { addCombinationToGroup, deleteGroup, getGroups } from "../controllers/combinationGroupController.js"


const router = express.Router()

router.post("/", addCombinationToGroup)
router.get("/", getGroups)
// combination groups routes
router.delete("/combination-groups/:id",authMiddleware, deleteGroup);



export default router