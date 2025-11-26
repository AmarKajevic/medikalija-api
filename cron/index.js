// cron/index.js
import { startSpecificationCron } from "./specificationCron.js";
import { startCalendarCron } from "./calendarCron.js";

export function startCronJobs() {
  console.log("🚀 Pokretanje CRON poslova...");

  startSpecificationCron();
  startCalendarCron();

  console.log("✔ Svi CRON poslovi pokrenuti.");
}
