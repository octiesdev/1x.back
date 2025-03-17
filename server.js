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

// 🔹 Функция парсинга `payload`
const parsePayload = (payloadBase64) => {
  try {
      if (!payloadBase64) return null;
      console.log("📌 Парсим payload (Base64):", payloadBase64);

      const msgBody = TonWeb.utils.base64ToBytes(payloadBase64);
      const cells = Cell.fromBoc(msgBody);

      if (cells.length === 0) {
          console.warn("⚠ Ошибка при парсинге payload: пустой BOC");
          return null;
      }

      const cell = cells[0]; // Берем первый root cell
      const slice = cell.beginParse();
      const op = slice.loadUint(32); // Загружаем 32-битный код операции
      console.log("🔹 Опкод:", op.toString());

      let comment = null;

      if (slice.remainingBits > 0) {
          let payloadBytes = [];
          while (slice.remainingBits > 0) {
              payloadBytes.push(slice.loadUint(8));
          }
          comment = new TextDecoder().decode(new Uint8Array(payloadBytes));
          console.log(`💬 Декодированный комментарий: ${comment}`);
      }

      return comment;
  } catch (error) {
      console.error("❌ Ошибка при парсинге payload:", error.message);
      return null;
  }
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
      const amountTON = parseFloat(nanoTON) / 1e9; // Переводим из наноTON в TON
      console.log(`✅ Транзакция от ${sender} на сумму ${amountTON} TON с комментарием: ${comment}`);

      // 🛠 Извлекаем userId из комментария (пример: "deposit:12345")
      const match = comment.match(/deposit:(\d+)/);
      const userId = match ? match[1] : null;

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

      // ✅ Проверяем, была ли транзакция уже обработана
      if (user.processedTransactions.includes(txHash)) {
          console.log(`⚠ Транзакция ${txHash} уже была обработана. Пропускаем.`);
          return;
      }

      // 💰 Обновляем баланс
      user.balance += amountTON;

      // ✅ Добавляем хэш транзакции в список обработанных
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