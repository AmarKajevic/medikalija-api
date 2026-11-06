import express from "express";
import { getNotifications, markAllAsRead, markReadOne } from "../controllers/notificationController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, getNotifications);
router.put("/read-all",authMiddleware, markAllAsRead);
router.put("/:id/read", authMiddleware, markReadOne)

export default router;
