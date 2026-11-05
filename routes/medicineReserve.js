import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager } from "../middleware/requireRole.js";
import {
  moveToReserve,
  getReserve,
  deleteReserveItem,
  returnFromReserve,
} from "../controllers/medicineReserveController.js";

const router = express.Router();

router.post("/move", authMiddleware, moveToReserve);
router.get("/", authMiddleware, getReserve);
router.delete("/:id", authMiddleware, requireManager, deleteReserveItem);
router.post("/return", authMiddleware, requireManager, returnFromReserve);

export default router;
