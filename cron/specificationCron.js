// cron/specificationCron.js
import cron from "node-cron";
import Specification from "../models/Specification.js";
import { createNotification } from "../controllers/notificationController.js";

export function startSpecificationCron() {
  // Radi svaki dan u 7:00 ujutru
  cron.schedule("0 16 * * *", async () => {
    console.log("⏳ Cron: Provera specifikacija...");

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const specs = await Specification.find().populate("patientId");

    for (const spec of specs) {
      const end = new Date(spec.endDate);
      end.setHours(0, 0, 0, 0);

      const diffDays = Math.ceil((end - today) / 86400000);

      console.log(
        `📌 Pacijent: ${spec.patientId.name} ${spec.patientId.lastName} | diffDays = ${diffDays}`
      );

      // 5, 4, 3, 2, 1 ili 0 dana do isteka
      if (diffDays <= 5 && diffDays >= 0) {
        await createNotification(
          spec.patientId.createdBy,
          "specification",
          `Specifikacija za pacijenta ${spec.patientId.name} ${spec.patientId.lastName} ističe za ${diffDays} dana.`
        );

        console.log("📨 Poslata notifikacija!");
      }
    }

    console.log("✔ Cron: Završena provera specifikacija.");
  });
}
