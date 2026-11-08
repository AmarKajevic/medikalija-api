import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { createPrice, deletePrice, listPrices, updatePrice } from "../controllers/lodgingPriceController.js";

const router = express.Router();

// Uprava bira cenu u obračunu; cenovnik menja admin
router.use(authMiddleware, requireManager);

router.get("/", listPrices);
router.post("/", requireRole("admin"), createPrice);
router.put("/:id", requireRole("admin"), updatePrice);
router.delete("/:id", requireRole("admin"), deletePrice);

export default router;
