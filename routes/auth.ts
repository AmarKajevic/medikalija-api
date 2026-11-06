import express from "express";
import type { Request, Response, NextFunction } from "express";
import {
  getCurrentUser,
  login,
  logout,
  refresh,
  register,
  listUsers,
  deleteUser
} from "../controllers/authController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();


// ---------------- AUTH ----------------
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/protected", authMiddleware, (req: Request, res: Response) => {
  res.json({
    success: true,
    message: "Access token validan ✅",
    user: req.user,
  });
});

// ---------------- REGISTER (samo admin) ----------------
router.post(
  "/register",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Samo admin može registrovati korisnike",
      });
    }
    next();
  },
  register
);

// ---------------- VERIFY CURRENT USER ----------------
router.get("/verify", authMiddleware, getCurrentUser);

// ---------------- LIST ALL USERS (admin & main-nurse) ----------------
router.get(
  "/users",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    if (!["admin", "main-nurse"].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Nedovoljno privilegija za listu korisnika",
      });
    }
    next();
  },
  listUsers
);

// ---------------- DELETE USER (samo admin) ----------------
router.delete(
  "/users/:id",
  authMiddleware,
  (req: Request, res: Response, next: NextFunction) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Samo admin može brisati korisnike",
      });
    }
    next();
  },
  deleteUser
);

export default router;
