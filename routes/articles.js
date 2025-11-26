import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { addArticle, addArticleToPatient, deleteArticle, getArticle, getArticles, getPatientArticles, updateArticle } from "../controllers/articlesController.js";
import UsedArticles from "../models/UsedArticles.js";

const router = express.Router();

router.post("/add", authMiddleware, addArticle);
router.get("/", authMiddleware, getArticles);
router.get("/:id", authMiddleware, getArticle);
router.put("/:id", authMiddleware, updateArticle);
router.delete("/:id", authMiddleware, deleteArticle);
router.post("/use", authMiddleware, addArticleToPatient);
router.get("/patientArticles/:patientId", authMiddleware, getPatientArticles);
router.delete("/patient/:patientId/articles/delete-all",authMiddleware, async (req, res) => {
    try {
        await UsedArticles.deleteMany({ patient: req.params.patientId });
            res.json({ success: true });
    } catch (error) {
        console.error("Greška:", err);
      res.status(500).json({ success: false });
    }
  
});




export default router;