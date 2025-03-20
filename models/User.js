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
        set: (value) => parseFloat(value.toFixed(2)) 
    },

    processedTransactions: {
        type: [String],
        default: [] 
    },

    freeOnex: {
        type: String,
        default: "не активирована"
    }, 

    farmEndTime: { 
        type: Date,
        default: null 
    },

    activePaidNodes: [
        {
            nodeId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "ONEXs" 
            },

            section: {
                type: String,
                required: true 
            },

            stake: {
                type: Number,
                required: true
            },

            apy: { 
                type: Number,
                required: true
            },

            days: {
                type: Number,
                required: true 
            },

            rewardTon: {
                type: Number,
                required: true
            },

            rewardOnex: {
                type: Number,
                required: true
            },

            farmEndTime: {
                type: Date,
                required: true
            },     
            
            status: {
                type: String,
                default: "таймер" 
            },
            
            totalReward: { // ✅ Добавляем поле, но НЕ отправляем на фронт
                type: Number,
                required: true
            },
        }
    ],

});

module.exports = mongoose.model("User", UserSchema);