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
        set: (value) => parseFloat(value).toFixed(2), // ✅ Храним число с двумя знаками после запятой
        get: (value) => value.toFixed(2) // ✅ Всегда отображаем 0.00
    }
    }, { toJSON: { getters: true }

});

module.exports = mongoose.model("User", UserSchema);