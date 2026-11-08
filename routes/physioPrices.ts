import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { listPhysioPrices, setPhysioPrice } from "../controllers/physioPriceController.js";

const router = express.Router();

// Uprava vidi cene (pri odobravanju), menja ih admin
router.use(authMiddleware, requireManager);
router.get("/", listPhysioPrices);
router.put("/:kind", requireRole("admin"), setPhysioPrice);

export default router;
