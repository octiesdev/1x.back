const mongoose = require("mongoose");

// 🔐 URL-подключения (замени <db_password> на реальный пароль!)
const DATABASE = "mongodb+srv://mentooorloo:<db_password>@viber1x.hyof6.mongodb.net/?retryWrites=true&w=majority&appName=viber1x";

async function connectDB() {
    try {
        await mongoose.connect(DATABASE, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("✅ Подключение к MongoDB успешно!");
    } catch (error) {
        console.error("❌ Ошибка подключения к MongoDB:", error);
        process.exit(1); // Остановить сервер, если ошибка
    }
}

module.exports = connectDB;