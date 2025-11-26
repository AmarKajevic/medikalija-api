// models/Medicine.js
import mongoose from "mongoose";

const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    pricePerUnit: { type: Number},

    // 👇 ukupna količina tableta u domu (Medikalija)
    quantity: { type: Number, required: true, default: 0 },

    // 👇 ukupna količina tableta od porodica (centralno, ne po pacijentu)
    familyQuantity: { type: Number, default: 0 },

    // 👇 koliko tableta ima jedno pakovanje (važi za ovaj lek)
    unitsPerPackage: { type: Number, default: 0 },

    // 👇 koliko *punih* pakovanja ima dom (računa se iz quantity)
    packageCount: { type: Number, default: 0 },

    // 👇 koliko *punih* pakovanja ima porodica (računa se iz familyQuantity)
    familyPackageCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const Medicine = mongoose.model("Medicine", medicineSchema);
export default Medicine;
