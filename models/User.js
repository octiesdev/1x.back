const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

    telegramId: {
        type: String,
        required: true,
        unique: true 
    },

    walletAddress: {
        type: String,
    },

    balance: {
        type: Number,
        default: 0
    },

});

module.exports = mongoose.model("User", UserSchema);