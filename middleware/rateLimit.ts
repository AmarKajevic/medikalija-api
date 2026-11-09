// Ograničenje broja zahteva po IP adresi (prijava, nova lozinka, osvežavanje sesije).
// Brojač je u bazi, ne u memoriji: na Vercelu svaki zahtev može doći na drugu instancu,
// pa bi brojač u memoriji bio neefikasan. Fiksni prozor; zapisi ističu sami (TTL indeks).
import mongoose from "mongoose";
import type { NextFunction, Request, Response } from "express";
import { log } from "../utils/logger.js";

const RateLimit =
  mongoose.models.RateLimit ??
  mongoose.model(
    "RateLimit",
    new mongoose.Schema(
      {
        _id: { type: String },
        count: { type: Number, default: 0 },
        expiresAt: { type: Date, required: true, expires: 0 },
      },
      { versionKey: false }
    )
  );

interface Options {
  /** Naziv grupe (deo ključa), npr. "login" */
  name: string;
  windowMs: number;
  max: number;
  message?: string;
}

export function rateLimit({ name, windowMs, max, message = "Previše pokušaja. Sačekajte malo pa pokušajte ponovo." }: Options) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const window = Math.floor(Date.now() / windowMs);
    const resetAt = (window + 1) * windowMs;
    const key = `${name}:${req.ip ?? "unknown"}:${window}`;
    try {
      const doc = await RateLimit.findOneAndUpdate(
        { _id: key },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } },
        { upsert: true, new: true, lean: true }
      );
      const count = (doc as { count?: number } | null)?.count ?? 0;
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, max - count)));
      if (count > max) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        res.setHeader("Retry-After", String(retryAfter));
        log.warn("rate_limited", { name, ip: req.ip });
        return res.status(429).json({ success: false, message });
      }
    } catch (err) {
      // Kvar brojača ne sme da zaključa prijavu — zahtev prolazi, greška se beleži
      log.error("rate_limit_failed", { name, message: (err as Error).message });
    }
    next();
  };
}
