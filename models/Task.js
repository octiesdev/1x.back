const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  imageUrl: { type: String, required: true },
  points: { type: Number, required: true },
  type: { type: String, enum: ["single", "dual"], required: true },
  link: { type: String, required: true },
  chatId: { type: String }, // ID канала/чата для проверки подписки
  styleClass: { type: String, default: "onex-task" },
});

module.exports = mongoose.model("Task", TaskSchema);