import mongoose from "mongoose";

const usedArticlesSchema = new mongoose.Schema({
    patient: {type: mongoose.Schema.Types.ObjectId, ref:"Patient", required: true },
    article: {type: mongoose.Schema.Types.ObjectId, ref: "Article", required: true},
    amount: {type: Number, required: true},
    priceAtTheTime: {type: Number, required: true},
    fromFamily: {type: Boolean, default: false},
    createdBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", required: true},  

},
    {timestamps:true}
)
const UsedArticles = mongoose.model("UsedArticles", usedArticlesSchema)
export default UsedArticles;