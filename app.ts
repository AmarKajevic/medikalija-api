import express from "express"
import cors from 'cors'
import cookieParser from "cookie-parser"
import helmet from "helmet"
import type { NextFunction, Request, Response } from "express"
import connectToDatabase from "./db/db.js"
import { allowedOrigins } from "./utils/cors.js"
import { GENERIC_ERROR } from "./utils/errors.js"
import { reportError } from "./utils/logger.js"
import authRouther from "./routes/auth.js"
import patientRouter from "./routes/patient.js"
import diagnosisRouter from "./routes/diganosis.js"
import diagnosisTemplateRouter from "./routes/diagnosisTemplate.js"
import medicineRouter from "./routes/medicine.js"
import analysisRouter from "./routes/analysis.js"
import combinationRouter from "./routes/combination.js"
import articlesRouter from "./routes/articles.js"
import specificationRouter from "./routes/specification.js"
import combinationGroupRouter from "./routes/combinationGroup.js"
import nurseActionRouter from "./routes/nurseActionsRoutes.js"
import activityRouter from "./routes/activity.js"
import calendarRoutes from "./routes/calendarRoutes.js"
import notificationRoutes from "./routes/notification.js"
import searchRouter from "./routes/search.js"
import medicineReserveRouter from "./routes/medicineReserve.js";
import exchangeRatesRouter from "./routes/exchangeRate.js"
import dashboardRouter from "./routes/dashboard.js"
import settingsRouter from "./routes/settings.js"
import nurseEntriesRouter from "./routes/nurseEntries.js"
import careTasksRouter from "./routes/careTasks.js"
import lodgingPricesRouter from "./routes/lodgingPrices.js";
import lodgingNotesRouter from "./routes/lodgingNotes.js";
import physioPricesRouter from "./routes/physioPrices.js";
import professionalServicesRouter from "./routes/professionalServices.js";
import medicalReportsRouter from "./routes/medicalReports.js"
import socialNotesRouter from "./routes/socialNotes.js"

// Express aplikacija bez pokretanja servera — koriste je index.ts i testovi.
const app = express();
app.disable("x-powered-by");
// Vercel je ispred aplikacije: prava IP adresa klijenta (ograničenje zahteva, sesije) je iz X-Forwarded-For
app.set("trust proxy", 1);
// Bezbednosna zaglavlja (HSTS, nosniff, frameguard...); API vraća samo JSON
app.use(helmet());

// Podešavanja ustanove nose logo (data URL), pa im treba veće ograničenje tela.
// Parser za tu rutu ide prvi; opšti parser posle toga preskače već pročitano telo.
app.use("/api/settings", express.json({ limit: "1mb" }));
app.use(express.json());
app.use(cookieParser());

app.use(
  cors({
    origin: allowedOrigins(),
    credentials: true,
  })
);

// Na Vercelu (serverless) aplikacija se poziva direktno, bez index.ts startServer(),
// pa se konekcija obezbeđuje pre svakog zahteva. Posle prve je odmah spremna (keš u db.ts).
// Stoji POSLE cors-a: i odgovor sa greškom mora imati CORS zaglavlja.
app.use(async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    console.error("Baza nije dostupna:", error);
    res.status(503).json({ success: false, message: "Baza podataka trenutno nije dostupna. Pokušajte ponovo." });
  }
});

// ===== ROUTES =====
app.use('/api/auth', authRouther)
app.use('/api/patient', patientRouter)
app.use('/api/diagnosis', diagnosisRouter)
app.use('/api/diagnosisTemplate', diagnosisTemplateRouter)
app.use('/api/medicine', medicineRouter)
app.use('/api/analysis', analysisRouter)
app.use('/api/analysis/combination', combinationRouter)
app.use('/api/articles', articlesRouter)
app.use('/api/specification', specificationRouter)
app.use('/api/combinationGroup', combinationGroupRouter)
app.use('/api/nurse-actions', nurseActionRouter)
app.use('/api/activity', activityRouter)
app.use('/api/calendar', calendarRoutes)
app.use('/api/notifications', notificationRoutes)
app.use("/api/search", searchRouter);
app.use("/api/medicine-reserve", medicineReserveRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/nurse-entries", nurseEntriesRouter);
app.use("/api/care-tasks", careTasksRouter);
app.use("/api/lodging-prices", lodgingPricesRouter);
app.use("/api/lodging-notes", lodgingNotesRouter);
app.use("/api/physio-prices", physioPricesRouter);
app.use("/api/professional-services", professionalServicesRouter);
app.use("/api/medical-reports", medicalReportsRouter);
app.use("/api/social-notes", socialNotesRouter);

// Nepoznata ruta: JSON umesto Express HTML stranice
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ success: false, message: "Ne postoji." });
});

// Greška koju ruta nije sama obradila (npr. neispravan JSON u telu): bez internih detalja ka klijentu
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ success: false, message: status === 413 ? "Zahtev je prevelik." : "Neispravan zahtev." });
  }
  reportError(err, { method: req.method, path: req.originalUrl });
  if (res.headersSent) return;
  res.status(500).json({ success: false, message: GENERIC_ERROR });
});

export default app;
