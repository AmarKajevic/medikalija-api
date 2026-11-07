import express from "express";
import { acceptLink, authConfig, changePassword, forgotPassword, getCurrentUser, getLink, googleLogin, login, logout, refresh } from "../controllers/authController.js";
import { addStaffRecord, deleteUser, inviteUser, listUsers, resendInvite, sendResetLink, updateUser } from "../controllers/usersController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";

const router = express.Router();
const admin = requireRole("admin");

// ---------------- Prijava i sesija (javno) ----------------
router.get("/config", authConfig);
router.post("/login", login);
router.post("/google", googleLogin);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.post("/forgot", forgotPassword);

// ---------------- Pozivnica / nova lozinka (javno, preko jednokratnog linka) ----------------
router.get("/link/:token", getLink);
router.post("/link/:token", acceptLink);

// ---------------- Sopstveni nalog ----------------
router.get("/verify", authMiddleware, getCurrentUser);
router.post("/password", authMiddleware, changePassword);

// ---------------- Korisnici (pristup samo po pozivu) ----------------
router.get("/users", authMiddleware, requireManager, listUsers);
router.post("/invitations", authMiddleware, admin, inviteUser);
router.post("/staff", authMiddleware, admin, addStaffRecord);
router.post("/users/:id/invite", authMiddleware, admin, resendInvite);
router.post("/users/:id/reset-link", authMiddleware, admin, sendResetLink);
router.patch("/users/:id", authMiddleware, admin, updateUser);
router.delete("/users/:id", authMiddleware, admin, deleteUser);

export default router;
