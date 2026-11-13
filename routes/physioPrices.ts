import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import { requireManager, requireRole } from "../middleware/requireRole.js";
import { chargePhysio, createPhysioKind, deletePhysioKind, listPhysioKindNames, listPhysioPrices, setPhysioPrice } from "../controllers/physioPriceController.js";

const router = express.Router();

// Vrste terapije (bez cena) vidi i fizioterapeut, da bi uneo terapiju
router.get("/kinds", authMiddleware, requireRole("admin", "main-nurse", "physiotherapist"), listPhysioKindNames);

// Uprava vidi cene (pri odobravanju) i dodaje terapiju u specifikaciju; cenovnik menja admin
router.use(authMiddleware, requireManager);
router.get("/", listPhysioPrices);
router.post("/charge", chargePhysio);
router.post("/", requireRole("admin"), createPhysioKind);
router.put("/:kind", requireRole("admin"), setPhysioPrice);
router.delete("/:kind", requireRole("admin"), deletePhysioKind);

export default router;
