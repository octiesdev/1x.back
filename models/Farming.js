const mongoose = require("mongoose");

const farmingSchema = new mongoose.Schema({

  availableNodes: {
    type: Number,
    default: 100 
  },
  totalNodes: {
    type: Number,
    default: 100
  }
});

const Farming = mongoose.model("Farming", farmingSchema);

module.exports = Farming;