require('dotenv').config(); // Загружаем переменные окружения
const express = require("express");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const User = require("./models/User");

// 🔐 Подключение к MongoDB
const DATABASE = process.env.DATABASE;

async function connectDB() {
  try {
      await mongoose.connect(DATABASE, {
          useNewUrlParser: true,
          useUnifiedTopology: true
      });
      console.log("✅ Подключение к MongoDB успешно!");
  } catch (error) {
      console.error("❌ Ошибка подключения к MongoDB:", error);
      process.exit(1);
  }
}

connectDB(); // Запускаем подключение к БД

// 🚀 Инициализация Express-сервера
const app = express();

const token = process.env.TELEGRAM_BOT_TOKEN; 
const bot = new TelegramBot(token, { polling: true });

const FRONTEND_URL = 'https://viber-redirect.netlify.app';

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const languageCode = msg.from.language_code || 'en'; 
  const isRussian = languageCode.startsWith('ru'); 

  // Адаптивные тексты
  const caption = isRussian
    ? 'Да-да, нет-нет ...'
    : 'Да-да, нет-нет ...';

  const buttonText = isRussian ? 'ONEX' : 'ONEX';
  const frontendUrl = `${FRONTEND_URL}?userId=${userId}`;

  // Путь к изображению
  const imagePath = path.join(__dirname, 'images', 'logo.onex.png');

  try {
    // Отправляем изображение с кнопкой
    await bot.sendPhoto(chatId, imagePath, {
      caption,
      reply_markup: {
        inline_keyboard: [
          [{ text: buttonText, web_app: { url: frontendUrl } }],
        ],
      },
    });
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    bot.sendMessage(chatId, isRussian
      ? 'Произошла ошибка при отправке сообщения.'
      : 'An error occurred while sending the message.');
  }
});

console.log('Бот запущен. Ожидаем команды /start...');

// ✅ Тестовый маршрут для проверки работы сервера
app.get("/", (req, res) => {
  res.send("🚀 Сервер запущен! MongoDB и Telegram бот работают.");
});

// 🚀 Запуск сервера
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🌍 Сервер работает на порту ${PORT}`));