// db.js
import mongoose from "mongoose";

let isConnected = false;

export default async function connectToDatabase() {
  if (isConnected) {
    // već povezani — koristi postojeću konekciju
    return;
  }

  const mongoUri = process.env.MONGODB_URL;

  if (!mongoUri) {
    throw new Error("❌ MONGODB_URL nije definisan u .env!");
  }

  try {
    const db = await mongoose.connect(mongoUri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = db.connections[0].readyState;
    console.log("✅ MongoDB connected:", db.connection.host);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}
