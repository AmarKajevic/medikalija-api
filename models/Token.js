import mongoose from "mongoose";

const tokenSchema = new mongoose.Schema({
    user:  {type: mongoose.Schema.Types.ObjectId, ref: "User" },
    token: {type: String, required: true},
    expiresAt: {type: String, required: true},

}) 

const Token = mongoose.model("Token", tokenSchema);
export default Token