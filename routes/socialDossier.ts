import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createDocument,
  deleteDocument,
  finalizeDocument,
  getProfile,
  listDeadlines,
  listStaff,
  listDocuments,
  saveProfile,
  updateDocument,
} from "../controllers/socialDossierController.js";

const router = express.Router();
const writers = requireRole("social-worker", "admin", "main-nurse");

// Socijalni dosije (lični podaci, procene, individualni plan): piše socijalni radnik i uprava,
// doktor može da čita — isti pristup kao socijalni karton
router.use(authMiddleware, requireRole("social-worker", "admin", "main-nurse", "doctor"));

router.get("/profile/:patientId", getProfile);
router.put("/profile/:patientId", writers, saveProfile);

router.get("/documents", listDocuments);
router.post("/documents", writers, createDocument);
router.put("/documents/:id", writers, updateDocument);
router.post("/documents/:id/finalize", writers, finalizeDocument);
router.delete("/documents/:id", writers, deleteDocument);

router.get("/deadlines", listDeadlines);
router.get("/staff", listStaff);

export default router;
