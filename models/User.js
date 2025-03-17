const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

    telegramId: {
        type: String,
        required: true,
        unique: true 
    },

    walletAddress: {
        type: String,
        default: null
    },

    balance: {
        type: Number,  // ✅ Используем число вместо строки
        default: 0.00,
        set: (value) => parseFloat(value.toFixed(2)) // ✅ Округляем до 2 знаков после запятой
    },

    processedTransactions: {
        type: [String],
        default: [] 
    } 

});

module.exports = mongoose.model("User", UserSchema);