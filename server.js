require('dotenv').config(); // Загружаем переменные окружения
const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const cors = require("cors");
const TonWeb = require("tonweb"); // Подключаем TonWeb для работы с BOC
const { Cell } = TonWeb.boc; // Импортируем Cell для парсинга



// 🔐 Подключение к MongoDB
const DATABASE = process.env.DATABASE;
const User = require("./models/User");


const TON_API_KEY = process.env.TON_API_KEY;
const WALLET_ADDRESS = "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs"; // Кошелек, на который отправляют депозиты
const API_URL = `https://testnet.tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions`; 


// 🔹 Функция конвертации HEX → UTF-8
const hexToUtf8 = (hex) => {
  return Buffer.from(hex.replace(/^0x/, ''), 'hex').toString('utf8');
};

const fetchTransactions = async () => {
  try {
      const response = await axios.get(API_URL, {
          headers: { Authorization: `Bearer ${TON_API_KEY}` },
          params: { limit: 5, decode: 1 }
      });

      const transactions = response.data.transactions;
      console.log("✅ Полученные транзакции:", transactions);

      for (const tx of transactions) {
          let sender = tx.in_msg?.source?.address || "unknown";
          let nanoTON = tx.in_msg?.value || 0; // Сумма в наноTON
          let comment = null;
          let txHash = tx.hash; // ✅ Хэш транзакции

          console.log("🔍 Проверяем транзакцию:", txHash);
          console.log("💰 Сумма (nanoTON):", nanoTON);

          // ✅ Попытка №1: `decoded_body.value.text`
          if (tx.in_msg?.decoded_body?.value?.text) {
              comment = tx.in_msg.decoded_body.value.text;
              console.log(`💬 Найден комментарий (decoded_body): ${comment}`);
          }

          // ✅ Попытка №2: `payload.value.text`
          if (!comment && tx.in_msg?.payload?.value?.text) {
              comment = tx.in_msg.payload.value.text;
              console.log(`💬 Найден комментарий (payload): ${comment}`);
          }

          // ✅ Попытка №3: Проверяем `raw_body`
          if (!comment && tx.in_msg?.decoded_op_name === "text_comment" && tx.in_msg?.raw_body) {
              console.log("🟡 raw_body (Base64):", tx.in_msg.raw_body);
              comment = hexToUtf8(tx.in_msg.raw_body.slice(16)); // Убираем метаданные
              console.log(`💬 Найден комментарий (raw_body → text_comment): ${comment}`);
          }

          // ✅ Передаём данные в обработчик
          if (comment) {
              await processTransaction({ sender, nanoTON, comment, txHash });
          } else {
              console.log("⚠ Комментарий не найден в транзакции.");
          }
      }
  } catch (error) {
      console.error("❌ Ошибка при получении транзакций:", error.response?.data || error.message);
  }
};

const processTransaction = async ({ sender, nanoTON, comment, txHash }) => {
  try {
      const amountTON = parseFloat(nanoTON) / 1e9;
      console.log(`✅ Транзакция от ${sender} на сумму ${amountTON} TON с комментарием: ${comment}`);

      const match = comment.match(/deposit:(\d+)/);
      const userId = match ? match[1] : null;

      if (!userId) {
          console.log("❌ Ошибка: не удалось извлечь userId.");
          return;
      }

      // 🔍 Проверяем, есть ли пользователь
      let user = await User.findOne({ telegramId: userId });

      if (!user) {
          console.log(`🚀 Создаём нового пользователя ${userId}...`);
          user = new User({
              telegramId: userId,
              walletAddress: null,
              balance: 0.00,
              processedTransactions: []
          });

          await user.save();
      }

      if (user.processedTransactions.includes(txHash)) {
          console.log(`⚠ Транзакция ${txHash} уже была обработана. Пропускаем.`);
          return;
      }

      user.balance += amountTON;
      user.processedTransactions.push(txHash);

      await user.save();
      console.log(`💰 Баланс пользователя ${userId} обновлён: +${amountTON} TON`);

  } catch (error) {
      console.error("❌ Ошибка при обработке транзакции:", error);
  }
};

setInterval(fetchTransactions, 30000);


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


// 🚀 Инициализация Express-сервера
const app = express();
app.use(cors());
app.use(express.json()); // Для обработки JSON-запросов

const token = process.env.TELEGRAM_BOT_TOKEN; 
const bot = new TelegramBot(token, { polling: true });

const FRONTEND_URL = "https://viber-redirect.netlify.app"; 

bot.onText(/\/start/, async (msg) => {
  console.log("📌 Полное сообщение от пользователя:", msg);

  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const languageCode = msg.from.language_code || 'en';
  const isRussian = languageCode.startsWith('ru');

  const frontendUrl = `${FRONTEND_URL}/?userId=${userId}`;
  console.log(`📌 Ссылка для пользователя: ${frontendUrl}`);

  const caption = isRussian ? 'Добро пожаловать! Нажмите кнопку, чтобы продолжить.' : 'Welcome! Click the button to continue.';
  const buttonText = isRussian ? 'Открыть приложение' : 'Open App';

  const imagePath = path.join(__dirname, 'images', 'logo.onex.png');

  try {
      let user = await User.findOne({ telegramId: userId });

      if (!user) {
          user = new User({
              telegramId: userId,
              walletAddress: null,
              balance: 0.00,
              processedTransactions: []
          });

          await user.save();
          console.log(`✅ Новый пользователь ${userId} добавлен в базу данных`);
      } else {
          console.log(`🔄 Пользователь ${userId} уже зарегистрирован.`);
      }

      await bot.sendPhoto(chatId, imagePath, {
          caption,
          reply_markup: {
              inline_keyboard: [
                  [{ text: buttonText, web_app: { url: frontendUrl } }]
              ]
          }
      });

  } catch (error) {
      console.error('❌ Ошибка при обработке команды /start:', error);
      bot.sendMessage(chatId, isRussian
          ? 'Произошла ошибка при обработке команды.'
          : 'An error occurred while processing the command.');
  }
});

console.log('Бот запущен. Ожидаем команды /start...');

app.get("/get-balance", async (req, res) => {
  try {
      const { userId } = req.query;

      if (!userId) {
          return res.status(400).json({ error: "userId is required" });
      }

      let user = await User.findOne({ telegramId: userId });

      if (!user) {
          return res.status(404).json({ error: "User not found" });
      }

      res.json({ balance: parseFloat(user.balance).toFixed(2) });

  } catch (error) {
      console.error("❌ Ошибка при получении баланса:", error);
      res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/get-user", async (req, res) => {
  try {
    const userId = req.headers.authorization; // ✅ Получаем `userId` из токена или сессии (лучший вариант)

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // ✅ Проверяем, есть ли пользователь в базе данных
    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ userId: user.telegramId }); // ✅ Возвращаем `userId`
  } catch (error) {
    console.error("Ошибка при получении userId:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Запуск сервера
const PORT = process.env.PORT;
app.listen(PORT, () => {
  console.log(`🌍 Сервер работает на порту ${PORT}`);
});