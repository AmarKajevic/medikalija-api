import Notification from "../models/Notification.js";

export const createNotification = async (userId, type, message) => {
  try {
    return await Notification.create({
      userId,
      type,
      message,
      isRead: false,
    });
  } catch (error) {
    console.log("Create notification error:", error);
  }
};

export const getNotifications = async (req, res) => {
  try {
    const userId = req.user._id; // 🔥 ispravka

    const list = await Notification.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.json({ success: true, notifications: list });
  } catch (err) {
    console.log("GET notifications error:", err);
    return res.status(500).json({ success: false });
  }
};

export const markAllAsRead = async (req, res) => {
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
export const markReadOne = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
}
