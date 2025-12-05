import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Token from "../models/Token.js";
import bcrypt from "bcrypt";
import { ACTIVE_ROLES, PASSIVE_ROLES, ALL_ROLES } from "../models/User.js";

// ------------------ JWT HELPERS ------------------
const generateAccessToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_KEY,
    { expiresIn: "4h" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
};

// ------------------ REGISTER ------------------
// Admin i main-nurse mogu kreirati korisnike
const register = async (req, res) => {
  try {
    const { name, lastName, email, password, role } = req.body;

    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Nepostojeća rola" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: "Email već postoji" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      lastName,
      email,
      passwordHash,
      role,
      loginAllowed: ACTIVE_ROLES.includes(role),
    });

    res.status(201).json({
      success: true,
      message: "Korisnik kreiran",
      user,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ------------------ LOGIN ------------------
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      email: { $regex: new RegExp(`^${email}$`, "i") }
    });

    if (!user)
      return res.status(404).json({ success: false, error: "Korisnik nije pronađen" });

    if (!user.loginAllowed)
      return res.status(403).json({ success: false, error: "Ovoj ulozi nije dozvoljen login" });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(400).json({ success: false, error: "Neispravna lozinka" });

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await Token.create({
      user: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        lastName: user.lastName,
        role: user.role,
        email: user.email,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ------------------ REFRESH TOKEN ------------------
const refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken)
      return res.status(400).json({ success: false, message: "Nedostaje refresh token" });

    const stored = await Token.findOne({ token: refreshToken });
    if (!stored)
      return res.status(403).json({ success: false, message: "Refresh token nije validan" });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded._id).select("-passwordHash");

    if (!user)
      return res.status(404).json({ success: false, message: "Korisnik ne postoji" });

    const newToken = generateAccessToken(user);

    res.status(200).json({ success: true, accessToken: newToken, user });
  } catch (err) {
    res.status(403).json({ success: false, message: "Neispravan ili istekao refresh token" });
  }
};

// ------------------ LOGOUT ------------------
const logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (refreshToken) {
      await Token.findOneAndDelete({ token: refreshToken });
      res.clearCookie("refreshToken");
    }
    res.status(200).json({ success: true, message: "Logged out" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ------------------ LIST ALL USERS ------------------
const listUsers = async (req, res) => {
  try {
    const users = await User.find().select("-passwordHash");
    res.status(200).json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ------------------ DELETE USER ------------------
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await User.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Korisnik obrisan" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// ------------------ CURRENT USER ------------------
const getCurrentUser = (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

const verify = (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

export { register, login, refresh, logout, listUsers, deleteUser, getCurrentUser, verify };
