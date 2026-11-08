import mongoose from "mongoose";

const usedArticlesSchema = new mongoose.Schema({
    patient: {type: mongoose.Schema.Types.ObjectId, ref:"Patient", required: true },
    article: {type: mongoose.Schema.Types.ObjectId, ref: "Article", required: true},
    amount: {type: Number, required: true},
    priceAtTheTime: {type: Number, required: true},
    fromFamily: {type: Boolean, default: false},
    createdBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},
    // Koliko je uzeto sa porodičnog, a koliko sa kućnog (domskog) stanja
    familyAmount: { type: Number, default: 0 },
    homeAmount: { type: Number, default: 0 },
    roleUsed: { type: String },  

},
    {timestamps:true}
)
// Profil pacijenta: potrošnja, najnovija prva
usedArticlesSchema.index({ patient: 1, createdAt: -1 });

const UsedArticles = mongoose.model("UsedArticles", usedArticlesSchema)
export default UsedArticles;