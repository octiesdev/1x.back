// models/Config.js
const mongoose = require("mongoose");

const ConfigSchema = new mongoose.Schema({
  depositAddress: {
    type: String,
    required: true
  }
});

module.exports = mongoose.model("Config", ConfigSchema);