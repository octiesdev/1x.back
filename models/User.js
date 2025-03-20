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
            }
        }
    ],

    // ✅ Новый массив истории купленных платных нод
    paidFarmingHistory: [
        {
            nodeId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "ONEXs"
            },
            section: String,
            stake: Number,
            apy: Number,
            days: Number,
            rewardTon: Number,
            rewardOnex: Number,
            farmStartTime: Date,
            farmEndTime: Date
        }
    ]

});

module.exports = mongoose.model("User", UserSchema);