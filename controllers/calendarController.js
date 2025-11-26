import CalendarEvent from "../models/CalendarEvent.js";

// GET ALL
export const getAllEvents = async (req, res) => {
  try {
    const events = await CalendarEvent.find().sort({ start: 1 });
    return res.json({ success: true, events });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Greška pri učitavanju događaja." });
  }
};

// CREATE
export const createEvent = async (req, res) => {
  try {
    const { title, start, end, calendar } = req.body;

    const event = await CalendarEvent.create({
      title,
      start,
      end,
      calendar,
      userId: req.user._id, // ⬅ OBAVEZNO
    });

    return res.json({ success: true, event });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Greška pri kreiranju događaja." });
  }
};

// UPDATE
export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, start, end, calendar } = req.body;

    const existing = await CalendarEvent.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Događaj nije pronađen." });
    }

    const updated = await CalendarEvent.findByIdAndUpdate(
      id,
      {
        title,
        start,
        end,
        calendar,
        userId: existing.userId, // ⬅ 100% SIGURNO ZADRŽAVAMO USERA
      },
      { new: true }
    );

    return res.json({ success: true, event: updated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Greška pri ažuriranju događaja." });
  }
};

// DELETE
export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await CalendarEvent.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Događaj nije pronađen." });
    }

    return res.json({ success: true, message: "Događaj obrisan." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Greška pri brisanju događaja." });
  }
};
