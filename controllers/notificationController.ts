import Notification from "../models/Notification.js";
import type { Request, Response } from "express";
import { param } from "../utils/http.js";

export const getNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id; // 🔥 ispravka

    const list = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json({ success: true, notifications: list });
  } catch (err) {
    console.log("GET notifications error:", err);
    return res.status(500).json({ success: false });
  }
};

export const markAllAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id; // 🔥 ispravka

    await Notification.updateMany(
      { userId },
      { $set: { isRead: true } }
    );

    return res.json({ success: true });
  } catch (error) {
    console.log("Mark all read error:", error);
    res.status(500).json({ success: false });
  }
};
export const markReadOne = async (req: Request, res: Response) => {
  try {
    await Notification.findByIdAndUpdate(param(req, "id"), { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
}
