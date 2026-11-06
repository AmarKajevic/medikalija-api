import type { HydratedDocument } from "mongoose";
import type { UserAttrs } from "../models/User.js";

declare global {
  namespace Express {
    interface Request {
      // Postavlja authMiddleware. Na rutama bez authMiddleware ne sme se koristiti.
      user: HydratedDocument<UserAttrs>;
    }
  }
}

export {};
