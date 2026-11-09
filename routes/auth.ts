import express from "express";
import { acceptLink, authConfig, changePassword, endOtherSessions, endSession, forgotPassword, getCurrentUser, getLink, googleLogin, login, logout, mySessions, refresh } from "../controllers/authController.js";
import { addStaffRecord, deleteUser, emailExistingLink, inviteUser, listUsers, resendInvite, sendResetLink, updateUser } from "../controllers/usersController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { originGuard } from "../middleware/originGuard.js";

const router = express.Router();
const admin = requireRole("admin");
const MIN = 60_000;

// Ograničenja po IP adresi (uz zaključavanje naloga posle 5 pogrešnih lozinki)
const loginLimit = rateLimit({ name: "login", windowMs: 15 * MIN, max: 30 });
const forgotLimit = rateLimit({ name: "forgot", windowMs: 15 * MIN, max: 5 });
const linkLimit = rateLimit({ name: "link", windowMs: 15 * MIN, max: 30 });
const refreshLimit = rateLimit({ name: "refresh", windowMs: MIN, max: 60 });

// ---------------- Prijava i sesija (javno) ----------------
router.get("/config", authConfig);
router.post("/login", loginLimit, login);
router.post("/google", loginLimit, googleLogin);
router.post("/refresh", refreshLimit, originGuard, refresh);
router.post("/logout", originGuard, logout);
router.post("/forgot", forgotLimit, forgotPassword);

// ---------------- Pozivnica / nova lozinka (javno, preko jednokratnog linka) ----------------
router.get("/link/:token", linkLimit, getLink);
router.post("/link/:token", linkLimit, acceptLink);

// ---------------- Sopstveni nalog ----------------
router.get("/verify", authMiddleware, getCurrentUser);
router.post("/password", authMiddleware, changePassword);
router.get("/sessions", authMiddleware, mySessions);
router.post("/sessions/revoke-others", authMiddleware, endOtherSessions);
router.delete("/sessions/:id", authMiddleware, endSession);

// ---------------- Korisnici (pristup samo po pozivu) ----------------
router.get("/users", authMiddleware, requireManager, listUsers);
router.post("/invitations", authMiddleware, admin, inviteUser);
router.post("/staff", authMiddleware, admin, addStaffRecord);
router.post("/users/:id/invite", authMiddleware, admin, resendInvite);
router.post("/users/:id/reset-link", authMiddleware, admin, sendResetLink);
router.post("/links/send", authMiddleware, admin, emailExistingLink);
router.patch("/users/:id", authMiddleware, admin, updateUser);
router.delete("/users/:id", authMiddleware, admin, deleteUser);

export default router;
