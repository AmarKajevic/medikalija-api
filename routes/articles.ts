import express from "express";
import type { Request, Response } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireManagerUnlessFamily } from "../middleware/requireRole.js";
import { addArticle, addArticleToPatient, deleteArticle, getArticle, getArticles, getPatientArticles, getPatientStockArticles, updateArticle } from "../controllers/articlesController.js";
import UsedArticles from "../models/UsedArticles.js";
import { param } from "../utils/http.js";

const router = express.Router();

router.post("/add", authMiddleware, requireManagerUnlessFamily, addArticle);
router.get("/", authMiddleware, getArticles);
router.get("/patient/:patientId", authMiddleware, getPatientStockArticles);
router.get("/:id", authMiddleware, getArticle);
router.put("/:id", authMiddleware, requireManager, updateArticle);
router.delete("/:id", authMiddleware, requireManager, deleteArticle);
router.post("/use", authMiddleware, addArticleToPatient);
router.get("/patientArticles/:patientId", authMiddleware, getPatientArticles);
router.delete("/patient/:patientId/articles/delete-all",authMiddleware, requireManager, async (req: Request, res: Response) => {
    try {
        await UsedArticles.deleteMany({ patient: param(req, "patientId") });
            res.json({ success: true });
    } catch (error) {
        console.error("Greška:", error);
      res.status(500).json({ success: false });
    }
  
});




export default router;