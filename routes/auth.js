import express from "express";
import {
  getCurrentUser,
  login,
  logout,
  refresh,
  register,
  verify,
  listUsers,
  deleteUser
} from "../controllers/authController.js";

import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();
router.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://medikalija-frontend.vercel.app");
  res.header("Access-Control-Allow-Credentials", "true");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});


// ---------------- AUTH ----------------
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/logout", logout);

router.get("/protected", authMiddleware, (req, res) => {
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
  (req, res, next) => {
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
  (req, res, next) => {
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
  (req, res, next) => {
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
