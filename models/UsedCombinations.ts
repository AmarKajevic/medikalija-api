import mongoose from "mongoose";


const UsedCombinationsSchema = new mongoose.Schema({
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "Patient", required: true },
    combination: { type: mongoose.Schema.Types.ObjectId, ref: "Combination", required: true },
    analyses: [
        {
          _id: { type: mongoose.Schema.Types.ObjectId, ref: "Analysis", required: true },
          name: String,
          price: Number,
        },
      ],
    totalPriceAtTheTime: {type: Number},
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

},{timestamps: true});

const UsedCombinations = mongoose.model("UsedCombinations", UsedCombinationsSchema);
export default UsedCombinations;