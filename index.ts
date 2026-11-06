// Mora biti prvi import: učitava .env pre nego što ostali moduli pročitaju process.env
import "dotenv/config";
import app from "./app.js";
import connectToDatabase from "./db/db.js";

async function startServer(): Promise<void> {
  await connectToDatabase(); // konekcija PRE prihvatanja zahteva
  const port = Number(process.env.PORT) || 5000;
  app.listen(port, () => console.log(`Server running on ${port}`));
}

startServer().catch((err: unknown) => {
  console.error("Server nije pokrenut:", err);
  process.exit(1);
});

export default app;
