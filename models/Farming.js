const mongoose = require("mongoose");

const farmingSchema = new mongoose.Schema({

  availableNodes: {
    type: Number,
    default: 1 
  }
});

const Farming = mongoose.model("Farming", farmingSchema);

module.exports = Farming;