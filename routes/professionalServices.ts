import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { chargeService, createService, deleteService, listServices, updateService } from "../controllers/professionalServiceController.js";

const router = express.Router();

// Uprava bira uslugu u specifikaciji; cenovnik menja admin
router.use(authMiddleware, requireManager);

router.get("/", listServices);
router.post("/charge", chargeService);
router.post("/", requireRole("admin"), createService);
router.put("/:id", requireRole("admin"), updateService);
router.delete("/:id", requireRole("admin"), deleteService);

export default router;
