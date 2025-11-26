// cron/calendarCron.js
import cron from "node-cron";
import CalendarEvent from "../models/CalendarEvent.js";
import { createNotification } from "../controllers/notificationController.js";

export function startCalendarCron() {
  // TEST: svakih 10 sekundi
 cron.schedule("0 16 * * *", async () => {
    console.log("⏳ Cron: Provera kalendarskih događaja... ", new Date());

    // 1) SUTRA (lokalno)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const year = tomorrow.getFullYear();
    const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const day = String(tomorrow.getDate()).padStart(2, "0");

    const targetDateStr = `${year}-${month}-${day}`; // npr "2025-11-23"

    const startOfDay = new Date(tomorrow);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(tomorrow);
    endOfDay.setHours(23, 59, 59, 999);

    console.log("🎯 Tražim evente između:", startOfDay, " i ", endOfDay);
    console.log("🎯 Ili sa start stringom:", targetDateStr);

    // 2) PODRŽI I Date i string polje "start"
    const events = await CalendarEvent.find({
      $or: [
        { start: { $gte: startOfDay, $lte: endOfDay } }, // ako je Date
        { start: targetDateStr },                        // ako je String
      ],
    });

    console.log("📊 Nađeno događaja:", events.length);

    for (const ev of events) {
      console.log(
        "📌 Event:",
        ev._id,
        ev.title,
        "start:",
        ev.start,
        "typeof start:",
        typeof ev.start,
        "userId:",
        ev.userId
      );

      if (!ev.userId) {
        console.log("⚠ Event nema userId, preskačem:", ev._id);
        continue;
      }

      await createNotification(
        ev.userId,
        "calendar",
        `Sutra: ${ev.title}`
      );

      console.log("📨 Poslata notifikacija za event:", ev._id);
    }

    console.log("✔ Cron: Kalendarski eventi obrađeni.");
  });
}
