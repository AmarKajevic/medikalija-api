import Notification from "../models/Notification.js";

export async function createNotification(userId, type, message) {
  try {
    await Notification.create({
      userId,
      type,
      message,
    });
  } catch (err) {
    console.error("Greška pri kreiranju notifikacije:", err);
  }
}
