import express from "express"
import authMiddleware from "../middleware/authMiddleware.js"
import { addCombinationToGroup, getGroups } from "../controllers/combinationGroupController.js"


const router = express.Router()

router.post("/", addCombinationToGroup)
router.get("/", getGroups)


export default router