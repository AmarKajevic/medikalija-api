import mongoose, { type HydratedDocumentFromSchema } from "mongoose";

// Događaj u kalendaru doma (pregled, poseta, podsetnik...).
//
// Čuvanje vremena:
//  - po satima (allDay: false): start/end su tačni trenuci (UTC), end > start
//  - celodnevni (allDay: true): start/end su UTC ponoći PRVOG i POSLEDNJEG dana (end uključiv)
//  - stari zapisi (allDay ne postoji): celodnevni, end je EKSKLUZIVAN (dan posle poslednjeg),
//    kako ih je čuvao FullCalendar — services/calendarEvents.ts ih tumači pri čitanju
//
// Ponavljanje: `recurrence` opisuje niz (dnevno/nedeljno/mesečno), `exdates` su
// početci termina izbačenih iz niza (obrisani ili izmenjeni pojedinačno). Pojedinačno
// izmenjen termin je zaseban događaj sa `recurringEventId` i `originalStart`.
export const EVENT_CATEGORIES = ["zelena", "plava", "narandzasta", "crvena"] as const;
export const LEGACY_CATEGORIES: Record<string, (typeof EVENT_CATEGORIES)[number]> = {
  Success: "zelena",
  Primary: "plava",
  Warning: "narandzasta",
  Danger: "crvena",
};

const recurrenceSchema = new mongoose.Schema(
  {
    freq: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
    interval: { type: Number, default: 1, min: 1, max: 99 },
    /** 0 = ponedeljak ... 6 = nedelja (samo za nedeljno) */
    byWeekday: [{ type: Number, min: 0, max: 6 }],
    /** Poslednji dan niza (UTC ponoć, uključiv) */
    until: { type: Date, default: null },
    count: { type: Number, default: null, min: 1, max: 500 },
  },
  { _id: false }
);

const CalendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: "", maxlength: 2000 },
    location: { type: String, trim: true, default: "", maxlength: 200 },
    allDay: { type: Boolean },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    calendar: { type: String, required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", default: null },
    recurrence: { type: recurrenceSchema, default: null },
    exdates: [{ type: Date }],
    recurringEventId: { type: mongoose.Schema.Types.ObjectId, ref: "CalendarEvent", default: null },
    originalStart: { type: Date, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

CalendarEventSchema.index({ start: 1, end: 1 });
CalendarEventSchema.index({ patient: 1, start: 1 });
CalendarEventSchema.index({ "recurrence.freq": 1 });

export type CalendarEventDoc = HydratedDocumentFromSchema<typeof CalendarEventSchema>;

export default mongoose.model("CalendarEvent", CalendarEventSchema);
