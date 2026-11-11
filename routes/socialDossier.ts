import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  createDocument,
  createResident,
  deleteDocument,
  finalizeDocument,
  getHistory,
  getMergeData,
  getMergeFields,
  getProfile,
  listDeadlines,
  listDocuments,
  listStaff,
  saveProfile,
  updateDocument,
} from "../controllers/socialDossierController.js";
import { createTemplate, deleteTemplate, downloadTemplate, listTemplates, updateTemplate } from "../controllers/documentTemplateController.js";

const router = express.Router();
const writers = requireRole("social-worker", "admin", "main-nurse");

// Socijalni dosije (lični podaci, procene, individualni plan, šabloni): piše socijalni radnik
// i uprava, doktor može da čita — isti pristup kao socijalni karton
router.use(authMiddleware, requireRole("social-worker", "admin", "main-nurse", "doctor"));

router.post("/residents", writers, createResident);

router.get("/profile/:patientId", getProfile);
router.patch("/profile/:patientId", writers, saveProfile);
router.get("/history/:patientId", getHistory);

router.get("/documents", listDocuments);
router.post("/documents", writers, createDocument);
router.put("/documents/:id", writers, updateDocument);
router.post("/documents/:id/finalize", writers, finalizeDocument);
router.delete("/documents/:id", writers, deleteDocument);

router.get("/deadlines", listDeadlines);
router.get("/staff", listStaff);

router.get("/merge-fields", getMergeFields);
router.get("/merge-data/:patientId", getMergeData);

router.get("/templates", listTemplates);
router.post("/templates", writers, createTemplate);
router.put("/templates/:id", writers, updateTemplate);
router.get("/templates/:id/file", downloadTemplate);
router.delete("/templates/:id", writers, deleteTemplate);

export default router;
