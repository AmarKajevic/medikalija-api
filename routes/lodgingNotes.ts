import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { createNote, deleteNote, listNotes, updateNote } from "../controllers/lodgingNoteController.js";

const router = express.Router();

// Uprava bira napomenu u obračunu; listu menja admin (uz cene smeštaja)
router.use(authMiddleware, requireManager);

router.get("/", listNotes);
router.post("/", requireRole("admin"), createNote);
router.put("/:id", requireRole("admin"), updateNote);
router.delete("/:id", requireRole("admin"), deleteNote);

export default router;
