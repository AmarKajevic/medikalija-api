import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  type: {
    type: String,
     enum: ["medicine", "analysis", "combination", "diagnosis", "note", "specification", "calendar","article"],
    required: true
  },

  message: { type: String, required: true },

  isRead: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now }
});

// Zvonce: nepročitana obaveštenja korisnika, najnovija prva
NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model("Notification", NotificationSchema);
