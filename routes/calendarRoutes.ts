import express from "express";
import { getEvents, createEvent, updateEvent, deleteEvent } from "../controllers/calendarController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole, requireStaff, SCHEDULER_ROLES } from "../middleware/requireRole.js";

const router = express.Router();
const schedulers = requireRole(...SCHEDULER_ROLES);

// Pregled ima celo osoblje. Zakazuju uprava, doktor (pregledi) i socijalni radnik
// (posete); doktor i socijalni radnik menjaju samo svoje termine.
router.use(authMiddleware, requireStaff);

router.get("/", getEvents);
router.post("/", schedulers, createEvent);
router.put("/:id", schedulers, updateEvent);
router.delete("/:id", schedulers, deleteEvent);

export default router;
