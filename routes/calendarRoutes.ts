import express from "express";
import { getEvents, createEvent, updateEvent, deleteEvent } from "../controllers/calendarController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";

const router = express.Router();

// Pregled ima celo osoblje (sestre vide termine pacijenata); menja samo uprava
router.use(authMiddleware, requireRole("admin", "main-nurse", "nurse", "doctor"));

router.get("/", getEvents);
router.post("/", requireManager, createEvent);
router.put("/:id", requireManager, updateEvent);
router.delete("/:id", requireManager, deleteEvent);

export default router;
