import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import { createNote, deleteNote, listNotes, setFollowUpDone, updateNote } from "../controllers/socialNoteController.js";

const router = express.Router();
const writers = requireRole("social-worker", "admin", "main-nurse");

// Socijalni karton: piše socijalni radnik (i uprava), doktor može da čita
router.use(authMiddleware, requireRole("social-worker", "admin", "main-nurse", "doctor"));

router.get("/", listNotes);
router.post("/", writers, createNote);
router.put("/:id", writers, updateNote);
router.post("/:id/follow-up", writers, setFollowUpDone);
router.delete("/:id", writers, deleteNote);

export default router;
