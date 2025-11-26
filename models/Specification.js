import mongoose from "mongoose";

const specificationSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    items: [
        {
            name: String,
            category: String,
            analyses: [{ _id: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis" }, name: String, price: Number }],
            price: Number,
            amount: Number,
            date: Date
        }
    ],
    totalPrice: { type: Number, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    lodgingPrice: { type: Number, default: 0 },      // cena smeštaja
    extraCosts: { type: Number, default: 0 },  
    createdAt: { type: Date, default: Date.now }
})

const Specification = mongoose.model("Specification", specificationSchema)
export default Specification