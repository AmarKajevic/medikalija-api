import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { getFacility, updateFacility } from "../controllers/settingsController.js";

const router = express.Router();

router.get("/facility", getFacility);
router.put("/facility", authMiddleware, requireRole("admin"), updateFacility);

export default router;
