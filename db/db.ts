import mongoose from "mongoose";

let connecting: Promise<typeof mongoose> | null = null;

// Jedna konekcija po procesu (Vercel ponovo koristi topli proces između zahteva).
export default async function connectToDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  const mongoUri = process.env.MONGODB_URL;
  if (!mongoUri) throw new Error("MONGODB_URL nije definisan u .env!");

  connecting ??= mongoose.connect(mongoUri, {
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  try {
    const db = await connecting;
    console.log("MongoDB connected:", db.connection.host);
  } catch (error) {
    connecting = null;
    console.error("MongoDB connection error:", error);
    throw error;
  }
}
