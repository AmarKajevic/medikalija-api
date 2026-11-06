import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { createTask, deleteTask, listTasks, updateTask } from "../controllers/careTaskController.js";

const router = express.Router();

router.use(authMiddleware, requireRole("admin", "main-nurse", "nurse", "doctor"));

router.get("/", listTasks);
router.post("/", requireManager, createTask);
router.put("/:id", requireManager, updateTask);
router.delete("/:id", requireManager, deleteTask);

export default router;
