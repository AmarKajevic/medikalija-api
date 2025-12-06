import express from "express"
import dotenv from 'dotenv'
import cors from 'cors'
import cookieParser from "cookie-parser"

import authRouther from "./routes/auth.js"
import connectToDatabase from "./db/db.js"
import patientRouter from "./routes/patient.js"
import diagnosisRouter from "./routes/diganosis.js"
import diagnosisTemplateRouter from "./routes/diagnosisTemplate.js"
import medicineRouter from "./routes/medicine.js"
import familyMedicineRouter from "./routes/familyMedicine.js"
import analysisRouter from "./routes/analysis.js"
import combinationRouter from "./routes/combination.js"
import articlesRouter from "./routes/articles.js"
import specificationRouter from "./routes/specification.js"
import combinationGroupRouter from "./routes/combinationGroup.js"
import nurseActionRouter from "./routes/nurseActionsRoutes.js"
import calendarRoutes from "./routes/calendarRoutes.js"
import notificationRoutes from "./routes/notification.js"
import searchRouter from "./routes/search.js"

dotenv.config()

const app = express();

// ✅ 1) CORS MORA BITI PRVI
app.use(
  cors({
    origin: "https://medikalija-frontend.vercel.app",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ 2) OVO JE KLJUČNO — preflight prolazi SIGURNO
app.options("*", cors());

// ⚠️ 3) TEK ONDA ostali middleware
app.use(express.json());
app.use(cookieParser());

// ===== ROUTES =====
app.use('/api/auth', authRouther)
app.use('/api/patient', patientRouter)
app.use('/api/diagnosis', diagnosisRouter)
app.use('/api/diagnosisTemplate', diagnosisTemplateRouter)
app.use('/api/medicine', medicineRouter)
app.use('/api/familyMedicine', familyMedicineRouter)
app.use('/api/analysis', analysisRouter)
app.use('/api/analysis/combination', combinationRouter)
app.use('/api/articles', articlesRouter)
app.use('/api/specification', specificationRouter)
app.use('/api/combinationGroup', combinationGroupRouter)
app.use('/api/nurse-actions', nurseActionRouter)
app.use('/api/calendar', calendarRoutes)
app.use('/api/notifications', notificationRoutes)
app.use("/api/search", searchRouter);

// GLOBAL ERROR HANDLER (VAŽNO ZA CORS)
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ success: false, message: "Server error" });
});

async function startServer() {
  await connectToDatabase();

  app.listen(process.env.PORT || 5000, () =>
    console.log(`🚀 Server running on ${process.env.PORT}`)
  );
}

startServer();
