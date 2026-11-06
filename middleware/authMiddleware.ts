import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import User from "../models/User.js";
import { requireEnv } from "../utils/env.js";

interface AccessTokenPayload {
  _id: string;
}

const isAccessPayload = (value: unknown): value is AccessTokenPayload =>
  typeof value === "object" && value !== null && typeof (value as { _id?: unknown })._id === "string";

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "Token not provided" });
  }

  try {
    const decoded = jwt.verify(token, requireEnv("JWT_KEY"));
    if (!isAccessPayload(decoded)) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    const user = await User.findById(decoded._id).select("-passwordHash");
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }

    req.user = user;
    next();
  } catch {
    return res.status(403).json({ success: false, message: "Invalid or expired token" });
  }
};

export default authMiddleware;
