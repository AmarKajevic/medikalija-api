import express from "express";
import {getCurrentUser, login, logout, refresh, register, verify} from "../controllers/authController.js"
import authMiddleware from "../middleware/authMiddleware.js"

const router = express.Router();

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

// samo vlasnik/admin može registrovati korisnike
router.post("/register", authMiddleware, (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Samo vlasnik može registrovati korisnike" });
  }
  next();
}, register);

// verify → vraća trenutnog korisnika
router.get("/verify", authMiddleware, getCurrentUser);

export default router;