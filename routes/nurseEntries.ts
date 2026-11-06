import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { accept, acceptBulk, cancel, create, list, pendingSummary, reject } from "../controllers/nurseEntryController.js";

const router = express.Router();
const staff = requireRole("admin", "main-nurse", "nurse", "doctor");

router.use(authMiddleware, staff);

router.get("/", list);
router.post("/", create);
router.get("/pending-summary", requireManager, pendingSummary);
router.post("/accept", requireManager, acceptBulk);
router.post("/:id/accept", requireManager, accept);
router.post("/:id/reject", requireManager, reject);
router.delete("/:id", cancel);

export default router;
