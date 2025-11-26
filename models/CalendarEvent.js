import mongoose from "mongoose";

const CalendarEventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },

  start: {
    type: Date,
    required: true,
  },

  end: {
    type: Date,
    required: true,
  },
  userId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  required: true,
},

  calendar: {
    type: String, // Danger, Success, Primary, Warning
    required: true,
  }
}, { timestamps: true });

export default mongoose.model("CalendarEvent", CalendarEventSchema);
