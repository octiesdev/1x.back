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
        type: Number,
        default: 0.00,
        set: (value) => parseFloat(value).toFixed(2) // ✅ Округляем до 2 знаков
    },

});

module.exports = mongoose.model("User", UserSchema);