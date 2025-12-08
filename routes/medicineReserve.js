import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  moveToReserve,
  getReserve,
} from "../controllers/medicineReserveController.js";

const router = express.Router();

router.post("/move", authMiddleware, moveToReserve);
router.get("/", authMiddleware, getReserve);

export default router;
