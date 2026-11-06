// Mora biti prvi import: učitava .env pre nego što ostali moduli pročitaju process.env
import "dotenv/config";
import app from "./app.js";
import connectToDatabase from "./db/db.js";

// Lokalno: konekcija pa listen. Na Vercelu se koristi samo izvezena aplikacija
// (konekciju obezbeđuje middleware u app.ts), bez listen() i bez process.exit().
async function startServer(): Promise<void> {
  await connectToDatabase();
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => console.log(`Server running on ${port}`));
}

if (!process.env.VERCEL) {
  startServer().catch((err: unknown) => {
    console.error("Server nije pokrenut:", err);
    process.exit(1);
  });
}

export default app;
