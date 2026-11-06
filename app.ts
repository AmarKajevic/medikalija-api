import express from "express"
import cors from 'cors'
import cookieParser from "cookie-parser"
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
import calendarRoutes from "./routes/calendarRoutes.js"
import notificationRoutes from "./routes/notification.js"
import searchRouter from "./routes/search.js"
import medicineReserveRouter from "./routes/medicineReserve.js";
import exchangeRatesRouter from "./routes/exchangeRate.js"
import dashboardRouter from "./routes/dashboard.js"

// Express aplikacija bez pokretanja servera — koriste je index.ts i testovi.
const app = express();
app.disable("x-powered-by");

app.use(express.json());
app.use(cookieParser());

const allowedOrigins = (process.env.CORS_ORIGIN || "https://medikalija-frontend.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

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
app.use('/api/calendar', calendarRoutes)
app.use('/api/notifications', notificationRoutes)
app.use("/api/search", searchRouter);
app.use("/api/medicine-reserve", medicineReserveRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/dashboard", dashboardRouter);

export default app;
