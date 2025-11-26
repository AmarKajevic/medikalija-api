import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Token from "../models/Token.js";
import bcrypt from "bcrypt";

// 🔑 Helperi za JWT
const generateAccessToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_KEY,            // koristi JWT_KEY
    { expiresIn: "1h" }             // access token traje 1h
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { _id: user._id, role: user.role },
    process.env.JWT_REFRESH_SECRET, // koristi refresh secret
    { expiresIn: "7d" }             // refresh token traje 7 dana
  );
};

// 📌 Registracija (samo vlasnik/admin može registrovati nove korisnike)
const register = async (req, res) => {
  try {
    const { name,lastName, email, password, role } = req.body;

    const existingUser = await User.findOne({ name, lastName });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email već postoji" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const user = await User.create({ name, lastName, email, passwordHash, role });

    res.status(201).json({ success: true, message: "Korisnik je kreiran", user });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// 📌 Login
const login = async (req, res) => {
  try {
    const { name, lastName, email, password } = req.body;

    const user = await User.findOne({
      name: { $regex: new RegExp(`^${name}$`, "i") },
      lastName: { $regex: new RegExp(`^${lastName}$`, "i") },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "Korisnik nije pronađen" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Neispravna lozinka" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await Token.create({
      user: user._id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 dana
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        name: user.name,
        lastName: user.lastName, // Dodaj ako koristiš u frontendu
        role: user.role,
        email: user.email,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

// 📌 Refresh access token
const refresh = async (req, res) => {
  try {
    // 🔑 Uzimamo refresh token iz cookie-ja
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({ success: false, message: "Nedostaje refresh token" });
    }

    // Da li postoji u bazi?
    const stored = await Token.findOne({ token: refreshToken });
    if (!stored) {
      return res.status(403).json({ success: false, message: "Neispravan refresh token" });
    }

    // Validacija refresh tokena
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Da li postoji korisnik?
    const user = await User.findById(decoded._id).select("-passwordHash");
    if (!user) {
      return res.status(404).json({ success: false, message: "Korisnik ne postoji" });
    }

    // Generiši novi access token
    const newAccessToken = jwt.sign(
      { _id: user._id, role: user.role },
      process.env.JWT_KEY,
      { expiresIn: "1h" } // access token važi 1h minuta
    );

    return res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      user,
    });
  } catch (error) {
    return res.status(403).json({ success: false, message: "Neispravan ili istekao refresh token" });
  }
};


// 📌 Logout
const logout = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;
  if (refreshToken) {
    await Token.findOneAndDelete({ token: refreshToken });
    res.clearCookie("refreshToken", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
  }
  res.status(200).json({ success: true, message: "Logged out" });
};

const verify = (req, res) => {
  return res.status(200).json({success: true, user: req.user})
}
// 📌 Verify / current user (posle authMiddleware)
const getCurrentUser = (req, res) => {
  res.status(200).json({ success: true, user: req.user });
};

export { register, login, refresh, logout, getCurrentUser, verify };
