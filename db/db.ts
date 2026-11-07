import mongoose from "mongoose";
import { ensureUserIndexes } from "../services/auth/indexes.js";

let connecting: Promise<typeof mongoose> | null = null;

// Jedna konekcija po procesu (Vercel ponovo koristi topli proces između zahteva).
export default async function connectToDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  const mongoUri = process.env.MONGODB_URL;
  if (!mongoUri) throw new Error("MONGODB_URL nije definisan u .env!");

  // Ako je veza pukla (npr. Atlas zatvorio konekciju na "toploj" Vercel funkciji),
  // staro obećanje je već ispunjeno, ali konekcije nema — pravi se nova.
  const { readyState } = mongoose.connection;
  if (readyState === 0 || readyState === 3) connecting = null;

  connecting ??= mongoose.connect(mongoUri, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  try {
    const db = await connecting;
    console.log("MongoDB connected:", db.connection.host);
    // Stare baze: indeks na e-mailu koji ne dozvoljava korisnike bez mejla
    await ensureUserIndexes();
  } catch (error) {
    connecting = null;
    console.error("MongoDB connection error:", error);
    throw error;
  }
}
