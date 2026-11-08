import mongoose from "mongoose";

const tokenSchema = new mongoose.Schema({
    user:  {type: mongoose.Schema.Types.ObjectId, ref: "User" },
    token: {type: String, required: true},
    expiresAt: {type: Date, required: true, expires: 0},

})

// Osvežavanje sesije traži po tokenu; odjava/brisanje po korisniku
tokenSchema.index({ token: 1 });
tokenSchema.index({ user: 1 });

const Token = mongoose.model("Token", tokenSchema);
export default Token