import express from "express";
import { getEvents, createEvent, updateEvent, deleteEvent } from "../controllers/calendarController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole, requireStaff, SCHEDULER_ROLES } from "../middleware/requireRole.js";

const router = express.Router();
const schedulers = requireRole(...SCHEDULER_ROLES);

// Pregled i zakazivanje: celo osoblje. Uprava menja sve termine, ostali samo svoje.
router.use(authMiddleware, requireStaff);

router.get("/", getEvents);
router.post("/", schedulers, createEvent);
router.put("/:id", schedulers, updateEvent);
router.delete("/:id", schedulers, deleteEvent);

export default router;
