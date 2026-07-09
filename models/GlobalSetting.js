// models/GlobalSetting.js
import mongoose from 'mongoose';

const globalSettingSchema = new mongoose.Schema({
  lowerExchangeRate: { type: Number, default: 0 },
  middleExchangeRate: { type: Number, default: 0 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('GlobalSetting', globalSettingSchema);