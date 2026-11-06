import jwt from "jsonwebtoken";
import { escapeRegex } from "../utils/escapeRegex.js";
import crypto from "crypto";
import User from "../models/User.js";
import Token from "../models/Token.js";
import bcrypt from "bcrypt";
import { ALL_ROLES, isActiveRole } from "../models/User.js";
import type { CookieOptions, Request, Response } from "express";
import { requireEnv } from "../utils/env.js";
import { errorMessage } from "../utils/errors.js";
import { param } from "../utils/http.js";

// ------------------ JWT HELPERS ------------------
interface TokenSubject {
  _id: unknown;
  role: string;
}

const generateAccessToken = (user: TokenSubject) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    requireEnv("JWT_KEY"),
    { expiresIn: "4h" }
  );
};

const generateRefreshToken = (user: TokenSubject) => {
  // jti garantuje da je svaki refresh token jedinstven čak i kad se
  // rotira više puta unutar iste sekunde (iat ima preciznost sekunde).
  return jwt.sign(
    { _id: user._id, role: user.role, jti: crypto.randomUUID() },
    requireEnv("JWT_REFRESH_SECRET"),
    { expiresIn: "7d" }
  );
};

const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: REFRESH_TOKEN_MAX_AGE,
});

const issueRefreshToken = async (user: TokenSubject) => {
  const refreshToken = generateRefreshToken(user);
  await Token.create({
    user: user._id,
    token: refreshToken,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_MAX_AGE),
  });
  return refreshToken;
};

// ------------------ REGISTER ------------------
const register = async (req: Request, res: Response) => {
  try {
    const { name, lastName, email, password, role } = req.body;

    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: "Nepostojeća rola" });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ success: false, message: "Email već postoji" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      lastName,
      email,
      passwordHash,
      role,
      loginAllowed: isActiveRole(role),
    });

    return res.status(201).json({
      success: true,
      message: "Korisnik uspešno kreiran",
      user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: errorMessage(err) });
  }
};

// ------------------ LOGIN (IME + PREZIME + LOZINKA) ------------------
const login = async (req: Request, res: Response) => {
  try {
    const { name, lastName, password } = req.body;

    if (!name || !lastName || !password) {
      return res.status(400).json({ success: false, error: "Nedostaju podaci" });
    }

    const user = await User.findOne({
      name: { $regex: new RegExp(`^${escapeRegex(String(name).trim())}$`, "i") },
      lastName: { $regex: new RegExp(`^${escapeRegex(String(lastName).trim())}$`, "i") },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "Korisnik nije pronađen" });
    }

    if (!user.loginAllowed) {
      return res.status(403).json({
        success: false,
        error: "Ovoj ulozi nije dozvoljen pristup sistemu",
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Neispravna lozinka" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(user);

    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

    return res.status(200).json({
      success: true,
      accessToken,
      user: {
        _id: user._id,
        name: user.name,
        lastName: user.lastName,
        role: user.role,
        email: user.email,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: errorMessage(err) });
  }
};

// ------------------ REFRESH TOKEN ------------------
const refresh = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken)
      return res.status(400).json({ success: false, message: "Nedostaje refresh token" });

    const stored = await Token.findOne({ token: refreshToken });
    if (!stored) {
      // Token nepoznat serveru — već je rotiran ili je falsifikovan.
      // Obrisi cookie kako bi se izbeglo dalje pokušavanje sa istim tokenom.
      res.clearCookie("refreshToken", refreshCookieOptions());
      return res.status(403).json({ success: false, message: "Refresh token nije validan" });
    }

    let subjectId: string;
    try {
      const decoded = jwt.verify(refreshToken, requireEnv("JWT_REFRESH_SECRET"));
      if (typeof decoded === "string" || typeof decoded._id !== "string") throw new Error("payload");
      subjectId = decoded._id;
    } catch {
      await Token.deleteOne({ _id: stored._id });
      res.clearCookie("refreshToken", refreshCookieOptions());
      return res.status(403).json({ success: false, message: "Neispravan ili istekao refresh token" });
    }

    const user = await User.findById(subjectId).select("-passwordHash");
    if (!user) {
      await Token.deleteOne({ _id: stored._id });
      return res.status(404).json({ success: false, message: "Korisnik ne postoji" });
    }

    // Rotacija: stari refresh token se briše, izdaje se novi.
    await Token.deleteOne({ _id: stored._id });
    const newRefreshToken = await issueRefreshToken(user);
    res.cookie("refreshToken", newRefreshToken, refreshCookieOptions());

    const newAccessToken = generateAccessToken(user);

    return res.status(200).json({ success: true, accessToken: newAccessToken, user });
  } catch (err) {
    return res.status(403).json({ success: false, message: "Neispravan ili istekao refresh token" });
  }
};

// ------------------ LOGOUT ------------------
const logout = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      await Token.findOneAndDelete({ token: refreshToken });
      res.clearCookie("refreshToken", refreshCookieOptions());
    }

    return res.status(200).json({ success: true, message: "Logged out" });
  } catch (err) {
    return res.status(500).json({ success: false, error: errorMessage(err) });
  }
};

// ------------------ LIST USERS ------------------
const listUsers = async (_req: Request, res: Response) => {
  try {
    const users = await User.find().select("-passwordHash");
    return res.status(200).json({ success: true, users });
  } catch (err) {
    return res.status(500).json({ success: false, error: errorMessage(err) });
  }
};

// ------------------ DELETE USER ------------------
const deleteUser = async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");

    await User.findByIdAndDelete(id);

    return res.status(200).json({ success: true, message: "Korisnik obrisan" });
  } catch (err) {
    return res.status(500).json({ success: false, error: errorMessage(err) });
  }
};

// ------------------ CURRENT USER ------------------
const getCurrentUser = (req: Request, res: Response) => {
  return res.status(200).json({ success: true, user: req.user });
};

const verify = (req: Request, res: Response) => {
  return res.status(200).json({ success: true, user: req.user });
};

export {
  register,
  login,
  refresh,
  logout,
  listUsers,
  deleteUser,
  getCurrentUser,
  verify
};
