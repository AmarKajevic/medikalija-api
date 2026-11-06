import type { Request, Response } from "express";
import CalendarEvent from "../models/CalendarEvent.js";
import { errorMessage, httpError, statusOf } from "../utils/errors.js";
import { param } from "../utils/http.js";
import { DAY_MS } from "../utils/dateUtils.js";
import { hasOccurrenceAt, listOccurrences, parseEventInput } from "../services/calendarEvents.js";
import { isManagerRole } from "../middleware/requireRole.js";

const fail = (res: Response, err: unknown) => res.status(statusOf(err)).json({ success: false, message: errorMessage(err) });

const parseInstant = (v: unknown, name: string) => {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw httpError(400, `Neispravan parametar "${name}".`);
  return d;
};

// Uprava menja sve; ostali samo događaje koje su sami zakazali
function assertCanModify(req: Request, event: { userId: unknown }) {
  if (!isManagerRole(req.user.role) && String(event.userId) !== String(req.user._id)) {
    throw httpError(403, "Možete da menjate samo termine koje ste vi zakazali.");
  }
}

async function populated(id: unknown) {
  return CalendarEvent.findById(id).populate("patient", "name lastName").populate("userId", "name lastName");
}

// GET /api/calendar?from=ISO&to=ISO&patientId=
// Bez opsega: od pre mesec dana do dva meseca unapred (stari klijenti)
export const getEvents = async (req: Request, res: Response) => {
  try {
    const now = Date.now();
    const from = req.query.from ? parseInstant(req.query.from, "from") : new Date(now - 31 * DAY_MS);
    const to = req.query.to ? parseInstant(req.query.to, "to") : new Date(now + 62 * DAY_MS);
    const events = await listOccurrences({ from, to, patientId: typeof req.query.patientId === "string" ? req.query.patientId : undefined });
    res.json({ success: true, events });
  } catch (err) {
    fail(res, err);
  }
};

export const createEvent = async (req: Request, res: Response) => {
  try {
    const input = await parseEventInput(req.body ?? {});
    const event = await CalendarEvent.create({ ...input, userId: req.user._id });
    res.status(201).json({ success: true, event: await populated(event._id) });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /api/calendar/:id
//   ceo događaj/niz (podrazumevano), ili
//   { scope: "occurrence", occurrenceStart } — samo jedan termin niza: postaje zaseban
//   događaj, a niz ga preskače
export const updateEvent = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const existing = await CalendarEvent.findById(id).catch(() => null);
    if (!existing) return res.status(404).json({ success: false, message: "Događaj nije pronađen." });
    assertCanModify(req, existing);
    const input = await parseEventInput(req.body ?? {});

    if (req.body?.scope === "occurrence") {
      if (!existing.recurrence?.freq) throw httpError(400, "Događaj se ne ponavlja.");
      if (input.recurrence) throw httpError(400, "Pojedinačan termin ne može imati svoje ponavljanje.");
      const occurrenceStart = parseInstant(req.body.occurrenceStart, "occurrenceStart");
      if (!hasOccurrenceAt(existing as never, occurrenceStart)) throw httpError(400, "Termin ne pripada ovom nizu.");

      const exception = await CalendarEvent.create({
        ...input,
        recurrence: null,
        recurringEventId: existing._id,
        originalStart: occurrenceStart,
        userId: existing.userId,
        updatedBy: req.user._id,
      });
      await CalendarEvent.updateOne({ _id: existing._id }, { $addToSet: { exdates: occurrenceStart } });
      return res.json({ success: true, event: await populated(exception._id) });
    }

    existing.set({ ...input, updatedBy: req.user._id });
    // Promena ponavljanja menja termine niza — stari izuzeci više ne odgovaraju
    if (!input.recurrence) existing.set({ exdates: [] });
    await existing.save();
    res.json({ success: true, event: await populated(existing._id) });
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/calendar/:id              ceo događaj (niz zajedno sa izmenjenim terminima)
// DELETE /api/calendar/:id?occurrence=  samo jedan termin niza
export const deleteEvent = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const existing = await CalendarEvent.findById(id).catch(() => null);
    if (!existing) return res.status(404).json({ success: false, message: "Događaj nije pronađen." });
    assertCanModify(req, existing);

    if (req.query.occurrence) {
      const occurrenceStart = parseInstant(req.query.occurrence, "occurrence");
      if (!existing.recurrence?.freq || !hasOccurrenceAt(existing as never, occurrenceStart)) {
        throw httpError(400, "Termin ne pripada ovom nizu.");
      }
      await CalendarEvent.updateOne({ _id: existing._id }, { $addToSet: { exdates: occurrenceStart } });
      return res.json({ success: true, message: "Termin je obrisan." });
    }

    await CalendarEvent.deleteMany({ $or: [{ _id: existing._id }, { recurringEventId: existing._id }] });
    res.json({ success: true, message: existing.recurrence?.freq ? "Svi termini su obrisani." : "Događaj je obrisan." });
  } catch (err) {
    fail(res, err);
  }
};
