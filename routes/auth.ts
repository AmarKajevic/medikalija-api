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

// Ograničenja broja zahteva (uz zaključavanje naloga posle 5 pogrešnih lozinki).
// Celo osoblje doma je često iza jedne IP adrese (isti ruter), pa se prijava broji po
// adresi + nalogu, a po samoj adresi samo velika granica (napad na mnogo naloga).
const identifierOf = (req: express.Request) => String(req.body?.identifier ?? `${req.body?.name ?? ""} ${req.body?.lastName ?? ""}`).trim().toLowerCase().slice(0, 100);
const loginLimit = rateLimit({ name: "login", windowMs: 15 * MIN, max: 20, key: (req) => `${req.ip}:${identifierOf(req)}` });
const loginIpLimit = rateLimit({ name: "login-ip", windowMs: 15 * MIN, max: 300 });
const forgotLimit = rateLimit({ name: "forgot", windowMs: 15 * MIN, max: 5, key: (req) => `${req.ip}:${identifierOf(req)}` });
const forgotIpLimit = rateLimit({ name: "forgot-ip", windowMs: 15 * MIN, max: 50 });
const linkLimit = rateLimit({ name: "link", windowMs: 15 * MIN, max: 100 });
// Osvežavanje: po sesiji (ID je deo kolačića), ne po adresi celog doma
const sessionOf = (req: express.Request) => String(req.cookies?.["__Secure-rt"] ?? req.cookies?.rt ?? req.ip).split(".")[0]!.slice(0, 40);
const refreshLimit = rateLimit({ name: "refresh", windowMs: MIN, max: 30, key: sessionOf });

// ---------------- Prijava i sesija (javno) ----------------
router.get("/config", authConfig);
router.post("/login", loginIpLimit, loginLimit, login);
router.post("/google", loginIpLimit, googleLogin);
router.post("/refresh", refreshLimit, originGuard, refresh);
router.post("/logout", originGuard, logout);
router.post("/forgot", forgotIpLimit, forgotLimit, forgotPassword);

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
