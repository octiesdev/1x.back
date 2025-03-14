const mongoose = require("mongoose");

// 🔐 URL-подключения (замени <db_password> на реальный пароль!)
const DATABASE = process.env.DATABASE;

async function connectDB() {
  try {
    await mongoose.connect(DATABASE);
    console.log("✅ Успешное подключение к MongoDB");
  } catch (err) {
    console.error("❌ Ошибка подключения к MongoDB:", err);
    process.exit(1); // Остановка сервера, если нет подключения
  }
}

module.exports = connectDB;