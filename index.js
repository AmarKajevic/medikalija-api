import express from "express"
import dotenv from 'dotenv'
import cors from 'cors'
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
import combinationGroupRouter from"./routes/combinationGroup.js"
import nurseActionRouter from "./routes/nurseActionsRoutes.js"
import calendarRoutes from "./routes/calendarRoutes.js";
import notificationRoutes from "./routes/notification.js";
import cookieParser from "cookie-parser";
import { startCronJobs } from "./cron/index.js";

dotenv.config() // Obavezno da se .env fajl učita
connectToDatabase()
startCronJobs();

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173", // 👈 tvoj frontend
    credentials: true, // dozvoli slanje cookie-a
  })
);
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




app.listen(process.env.PORT, () => {
    console.log(`server is runing on ${process.env.PORT}`)
})