require('dotenv').config(); // Загружаем переменные окружения
const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const cors = require("cors");


// 🔐 Подключение к MongoDB
const DATABASE = process.env.DATABASE;
const User = require("./models/User");


const TON_API_KEY = process.env.TON_API_KEY;
const WALLET_ADDRESS = "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs"; // Кошелек, на который отправляют депозиты
const API_URL = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions`; 

const fetchTransactions = async () => {
  try {
      const response = await axios.get(API_URL, {
          headers: { Authorization: `Bearer ${TON_API_KEY}` },
          params: { limit: 10 } // Получаем последние 10 транзакций
      });

      const transactions = response.data.transactions;
      console.log("✅ Полученные транзакции:", transactions);

      for (const tx of transactions) {
          if (
              tx.in_msg &&
              tx.in_msg.body &&
              tx.in_msg.body.value &&
              tx.in_msg.body.value.text // Проверяем, есть ли комментарий
          ) {
              // 📌 Переносим комментарий в `tx.in_msg.comment`
              tx.in_msg.comment = tx.in_msg.body.value.text; 
              console.log(`💬 Извлечён комментарий: ${tx.in_msg.comment}`);
              
              await processTransaction(tx); // Обрабатываем транзакцию
          } else {
              console.log(`⚠️ Транзакция ${tx.hash} без комментария. Пропускаем.`);
          }
      }
  } catch (error) {
      console.error("❌ Ошибка при получении транзакций:", error.response?.data || error.message);
  }
};

// Подключение к MongoDB
async function connectDB() {
  try {
    await mongoose.connect(DATABASE);
    console.log("✅ Успешное подключение к MongoDB");
  } catch (err) {
    console.error("❌ Ошибка подключения к MongoDB:", err);
    process.exit(1); // Остановка сервера, если нет подключения
  }
}

connectDB();


async function resetBalances() {
  await User.updateMany({}, { $set: { balance: 0.00 } });
  console.log("✅ Балансы обновлены!");
}

resetBalances();

const processTransaction = async (tx) => {
  try {
      const amountTON = parseFloat(tx.in_msg?.value) / 1e9; // Переводим из наноTON в TON
      const senderAddress = tx.in_msg?.source;

      // ⚡ Извлекаем комментарий из возможных мест
      let comment = tx.in_msg?.comment || 
                    tx.in_msg?.payload?.value?.text || 
                    tx.actions?.[0]?.msg?.message_internal?.body?.value?.value?.text || 
                    null;

      if (!comment) {
          console.log(`🔸 Транзакция на ${amountTON} TON без комментария. Пропускаем.`);
          return;
      }

      console.log(`✅ Транзакция от ${senderAddress} с комментарием: ${comment}`);

      // 🛠 Извлекаем userId из комментария (пример: "deposit:12345")
      const userId = comment.startsWith("deposit:") ? comment.split(":")[1] : null;
      if (!userId) {
          console.log("❌ Ошибка: не удалось извлечь userId.");
          return;
      }

      // 🔍 Ищем пользователя в базе
      let user = await User.findOne({ telegramId: userId });
      if (!user) {
          console.log(`❌ Пользователь ${userId} не найден.`);
          return;
      }

      // 💰 Обновляем баланс
      user.balance += amountTON;
      await user.save();
      console.log(`💰 Баланс пользователя ${userId} обновлён: +${amountTON} TON`);

  } catch (error) {
      console.error("❌ Ошибка при обработке транзакции:", error);
  }
};

setInterval(fetchTransactions, 60000);

// 🚀 Инициализация Express-сервера
const app = express();
app.use(cors());
app.use(express.json()); // Для обработки JSON-запросов

const token = process.env.TELEGRAM_BOT_TOKEN; 
const bot = new TelegramBot(token, { polling: true });

const FRONTEND_URL = "https://viber-redirect.netlify.app"; 

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  console.log("📌 Полное сообщение от пользователя:", msg);
  console.log("📌 userId:", msg.from?.id); // Проверяем, есть ли `msg.from.id`
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const languageCode = msg.from.language_code || 'en'; 
  const isRussian = languageCode.startsWith('ru'); 

  // ✅ Добавляем userId в URL только здесь, когда он уже объявлен
  const frontendUrl = `${FRONTEND_URL}/?userId=${userId}`;
  console.log(`📌 Ссылка для пользователя: ${frontendUrl}`);

  // Адаптивные тексты
  const caption = isRussian
    ? 'Да-да, нет-нет ...'
    : 'Да-да, нет-нет ...';

  const buttonText = isRussian ? 'ONEX' : 'ONEX';

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

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      user = new User({
        telegramId: userId,
        walletAddress: null, // ✅ Если у пользователя еще нет кошелька, ставим null
        balance: 0.00
      });

      await user.save();
      console.log(`✅ Новый пользователь ${userId} добавлен в базу данных`);
    }
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    bot.sendMessage(chatId, isRussian
      ? 'Произошла ошибка при отправке сообщения.'
      : 'An error occurred while sending the message.');
  }
});

console.log('Бот запущен. Ожидаем команды /start...');

// ✅ Добавляем эндпоинт для получения баланса
app.get("/get-balance", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ balance: parseFloat(user.balance).toFixed(2) }); // Баланс в формате 0.00
  } catch (error) {
    console.error("❌ Ошибка при получении баланса:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/users", async (req, res) => {
  const users = await User.find();
  res.json(users);
});

// Запуск сервера
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`🌍 Сервер работает на порту ${PORT}`);
});