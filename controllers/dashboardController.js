import Patient from "../models/Patient.js";
import User, { ACTIVE_ROLES } from "../models/User.js";
import Medicine from "../models/Medicine.js";
import CalendarEvent from "../models/CalendarEvent.js";
import Notification from "../models/Notification.js";
import Diagnosis from "../models/Diagnosis.js";
import UsedArticles from "../models/UsedArticles.js";
import UsedMedicine from "../models/UsedMedicine.js";

const LOW_STOCK_THRESHOLD = 10;
const MANAGER_ROLES = ["admin", "main-nurse"];

const getRecentActivity = async (createdByFilter, limit) => {
  const match = createdByFilter ? { createdBy: createdByFilter } : {};
  const perCollectionLimit = limit;

  const [diagnoses, articles, medicines] = await Promise.all([
    Diagnosis.find(match)
      .sort({ createdAt: -1 })
      .limit(perCollectionLimit)
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName"),
    UsedArticles.find(match)
      .sort({ createdAt: -1 })
      .limit(perCollectionLimit)
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName")
      .populate("article", "name"),
    UsedMedicine.find(match)
      .sort({ createdAt: -1 })
      .limit(perCollectionLimit)
      .populate("createdBy", "name lastName role")
      .populate("patient", "name lastName")
      .populate("medicine", "name"),
  ]);

  const activity = [];

  diagnoses.forEach((d) => {
    activity.push({
      type: "Dijagnoza",
      patient: `${d.patient?.name || ""} ${d.patient?.lastName || ""}`.trim(),
      createdBy: d.createdBy
        ? { name: d.createdBy.name, lastName: d.createdBy.lastName, role: d.createdBy.role }
        : null,
      description: d.description,
      createdAt: d.createdAt,
    });
  });

  articles.forEach((a) => {
    activity.push({
      type: "Artikal",
      patient: `${a.patient?.name || ""} ${a.patient?.lastName || ""}`.trim(),
      createdBy: a.createdBy
        ? { name: a.createdBy.name, lastName: a.createdBy.lastName, role: a.createdBy.role }
        : null,
      description: `${a.article?.name || "Nepoznat artikal"} — ${a.amount} kom`,
      createdAt: a.createdAt,
    });
  });

  medicines.forEach((m) => {
    activity.push({
      type: "Lek",
      patient: `${m.patient?.name || ""} ${m.patient?.lastName || ""}`.trim(),
      createdBy: m.createdBy
        ? { name: m.createdBy.name, lastName: m.createdBy.lastName, role: m.createdBy.role }
        : null,
      description: `${m.medicine?.name || "Nepoznat lek"} — ${m.amount} kom`,
      createdAt: m.createdAt,
    });
  });

  activity.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return activity.slice(0, limit);
};

export const getStats = async (req, res) => {
  try {
    const isManager = MANAGER_ROLES.includes(req.user.role);
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
      const recentActivity = await getRecentActivity(req.user._id, 10);

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
      User.aggregate([
        { $match: { role: { $in: ACTIVE_ROLES } } },
        { $group: { _id: "$role", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Medicine.find({ quantity: { $lte: LOW_STOCK_THRESHOLD } })
        .sort({ quantity: 1 })
        .select("name quantity unitsPerPackage")
        .limit(10),
      getRecentActivity(null, 10),
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
