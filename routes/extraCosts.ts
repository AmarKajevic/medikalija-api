import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { createExtraCost, deleteExtraCost, listExtraCosts, updateExtraCost } from "../controllers/extraCostController.js";

const router = express.Router();

// Uprava bira trošak u specifikaciji; cenovnik menja admin
router.use(authMiddleware, requireManager);

router.get("/", listExtraCosts);
router.post("/", requireRole("admin"), createExtraCost);
router.put("/:id", requireRole("admin"), updateExtraCost);
router.delete("/:id", requireRole("admin"), deleteExtraCost);

export default router;
