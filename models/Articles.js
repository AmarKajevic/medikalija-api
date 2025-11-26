import mongoose from "mongoose";

const articleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },

    // 👇 ukupna količina artikla u domu
    quantity: { type: Number, required: true, default: 0 },

    // 👇 ukupna količina artikla doneta od porodice
    familyQuantity: { type: Number, default: 0 },

    // 👇 koliko artikala ima jedno pakovanje
    unitsPerPackage: { type: Number, default: 0 },

    // 👇 broj punih pakovanja (računa se iz quantity)
    packageCount: { type: Number, default: 0 },

    // 👇 broj punih porodičnih pakovanja (računa se iz familyQuantity)
    familyPackageCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const Article = mongoose.model("Article", articleSchema);
export default Article;
