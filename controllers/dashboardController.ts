import Patient from "../models/Patient.js";
import User, { ACTIVE_ROLES } from "../models/User.js";
import Medicine from "../models/Medicine.js";
import CalendarEvent from "../models/CalendarEvent.js";
import Notification from "../models/Notification.js";
import { isManagerRole } from "../middleware/requireRole.js";
import { loadActivity } from "../services/activityFeed.js";
import type { Request, Response } from "express";

const LOW_STOCK_THRESHOLD = 10;

export const getStats = async (req: Request, res: Response) => {
  try {
    const isManager = isManagerRole(req.user.role);
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [activePatients, upcomingEvents, unreadNotifications] = await Promise.all([
      Patient.countDocuments({ dischargeDate: null }),
      CalendarEvent.find({ start: { $gte: now, $lte: in7Days } })
        .sort({ start: 1 })
        .limit(5),
      Notification.countDocuments({ userId: req.user._id, isRead: false }),
    ]);

    if (!isManager) {
      const recentActivity = await loadActivity({ createdBy: req.user._id, limit: 10 });

      return res.status(200).json({
        success: true,
        stats: {
          scope: "personal",
          activePatients,
          upcomingEvents,
          unreadNotifications,
          recentActivity,
        },
      });
    }

    const in30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      dischargedPatients,
      admittedLast30Days,
      staffByRole,
      lowStockMedicines,
      recentActivity,
    ] = await Promise.all([
      Patient.countDocuments({ dischargeDate: { $ne: null } }),
      Patient.countDocuments({ admissionDate: { $gte: in30Days } }),
      User.aggregate<{ _id: string; count: number }>([
        { $match: { role: { $in: [...ACTIVE_ROLES] } } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Medicine.find({ quantity: { $lte: LOW_STOCK_THRESHOLD } })
        .sort({ quantity: 1 })
        .select("name quantity unitsPerPackage")
        .limit(10),
      loadActivity({ limit: 10 }),
    ]);

    return res.status(200).json({
      success: true,
      stats: {
        scope: "facility",
        patients: {
          active: activePatients,
          discharged: dischargedPatients,
          admittedLast30Days,
        },
        staffByRole: staffByRole.map((r) => ({ role: r._id, count: r.count })),
        lowStockMedicines,
        upcomingEvents,
        unreadNotifications,
        recentActivity,
      },
    });
  } catch (err) {
    console.error("Greška u getStats:", err);
    return res.status(500).json({ success: false, error: "Greška pri učitavanju statistike" });
  }
};
