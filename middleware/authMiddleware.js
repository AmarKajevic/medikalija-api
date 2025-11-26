import jwt from "jsonwebtoken";
import User from "../models/User.js";

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  console.log("authHeader:", authHeader);

  const token = authHeader && authHeader.split(" ")[1];
  console.log("token:", token);

  if (!token) {
    return res.status(401).json({ success: false, message: "Token not provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_KEY);
    console.log("decoded:", decoded);

    const user = await User.findById(decoded._id).select("-passwordHash");
    console.log("user from DB:", user);

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (err) {
    console.log("JWT error:", err.message);
    return res.status(403).json({ success: false, message: "Invalid or expired token" });
  }
};


export default authMiddleware;

