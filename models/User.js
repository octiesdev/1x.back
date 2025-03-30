const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({

    telegramId: {
        type: String,
        required: true,
        unique: true 
    },

    username: {
        type: String,
        default: null
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
            }
        }
    ],

    purchasedPaidNodes: [
        {
            nodeId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "ONEXs",
                required: true
            },
            stake: {
                type: Number,
                required: true
            },
            rewardTon: {
                type: Number,
                required: true
            },
            farmEndTime: {
                type: Date,
                required: true
            },
            status: {
                type: String,
                enum: ["таймер", "зафармлено"],
                default: "таймер"
            },
            createdAt: {
                type: Date,
                default: Date.now
            }
        }
    ],

    depositHistory: [
        {
          amount: Number,
          txHash: String,
          createdAt: { type: Date, default: Date.now }
        }
    ],

    withdrawOrders: [
        { 
            amount: Number,
            status: String,
            createdAt: Date 
        }
    ],

    completedTasks: {
        type: [String], 
        default: [],
    },

    refCode: { type: String, unique: true },
    referredBy: { type: String }, // Код того, кто пригласил
    referrals: [{ type: String }] // Массив telegramId приглашённых

});

module.exports = mongoose.model("User", UserSchema);