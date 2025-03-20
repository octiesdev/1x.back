require('dotenv').config();
const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const cors = require("cors");
const TonWeb = require("tonweb");

const DATABASE = process.env.DATABASE;
const User = require("./models/User");
const Farming = require("./models/Farming"); // ✅ Подключаем схему Farming

const TON_API_KEY = process.env.TON_API_KEY;
const WALLET_ADDRESS = "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs";
const API_URL = `https://testnet.tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions`;

const fetch = require("node-fetch"); // если fetch не работает, установи: npm install node-fetch

const ADMIN_API_URL = "https://adminviber1x-production.up.railway.app"; // Адрес админ-панели

async function getNodeById(nodeId) {
    try {
        const response = await fetch(`${ADMIN_API_URL}/onex-nodes/${nodeId}`);
        if (!response.ok) throw new Error(`Ошибка получения ноды: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error("❌ Ошибка при запросе ноды с админ-панели:", error);
        return null;
    }
}

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
            let nanoTON = tx.in_msg?.value || 0;
            let comment = null;
            let txHash = tx.hash;

            console.log("🔍 Проверяем транзакцию:", txHash);
            console.log("💰 Сумма (nanoTON):", nanoTON);

            if (tx.in_msg?.decoded_body?.value?.text) {
                comment = tx.in_msg.decoded_body.value.text;
                console.log(`💬 Найден комментарий (decoded_body): ${comment}`);
            } else if (tx.in_msg?.payload?.value?.text) {
                comment = tx.in_msg.payload.value.text;
                console.log(`💬 Найден комментарий (payload): ${comment}`);
            } else if (tx.in_msg?.decoded_op_name === "text_comment" && tx.in_msg?.raw_body) {
                console.log("🟡 raw_body (Base64):", tx.in_msg.raw_body);
                comment = hexToUtf8(tx.in_msg.raw_body.slice(16));
                console.log(`💬 Найден комментарий (raw_body → text_comment): ${comment}`);
            }

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

async function connectDB() {
    try {
        await mongoose.connect(DATABASE);
        console.log("✅ Успешное подключение к MongoDB");
    } catch (err) {
        console.error("❌ Ошибка подключения к MongoDB:", err);
        process.exit(1);
    }
}

connectDB();

const app = express();

app.use(cors({ origin: "https://viber-redirect.netlify.app" })); // Указываем домен фронта
app.use(express.json()); // Для работы с JSON

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

// ✅ Роут для регистрации пользователя
app.post("/register-user", async (req, res) => {
  try {
      const { telegramId } = req.body;

      if (!telegramId) {
          return res.status(400).json({ error: "telegramId is required" });
      }

      let user = await User.findOne({ telegramId });

      if (!user) {
          console.log(`🚀 Новый пользователь ${telegramId}, создаём...`);
          user = new User({ telegramId, balance: 0.00, walletAddress: null });
          await user.save();
      }

      res.json({ success: true, userId: user.telegramId });
  } catch (error) {
      console.error("❌ Ошибка при регистрации пользователя:", error);
      res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Роут для получения userId
app.get("/get-user", async (req, res) => {
  try {
      const telegramId = req.headers["x-telegram-id"];

      if (!telegramId) {
          return res.status(400).json({ error: "telegramId is required in headers" });
      }

      let user = await User.findOne({ telegramId });

      if (!user) {
          return res.status(404).json({ error: "User not found" });
      }

      res.json({ userId: user.telegramId });
  } catch (error) {
      console.error("❌ Ошибка при получении userId:", error);
      res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Роут для получения баланса
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

app.post("/update-wallet", async (req, res) => {
  try {
      const { userId, walletAddress } = req.body;

      if (!userId || !walletAddress) {
          return res.status(400).json({ error: "❌ userId и walletAddress обязательны!" });
      }

      let user = await User.findOne({ telegramId: userId });

      if (!user) {
          return res.status(404).json({ error: "❌ Пользователь не найден!" });
      }

      user.walletAddress = walletAddress; // ✅ Обновляем кошелек
      await user.save();

      console.log(`✅ Кошелек ${walletAddress} сохранен для пользователя ${userId}`);
      res.json({ success: true, walletAddress });
  } catch (error) {
      console.error("❌ Ошибка при обновлении кошелька:", error);
      res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/start-farming", async (req, res) => {
  try {
    const { userId } = req.body;
    let user = await User.findOne({ telegramId: userId });
    let farming = await Farming.findOne();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!farming) {
      farming = new Farming({ availableNodes: 100 }); // ✅ Создаем запись, если ее нет
      await farming.save();
    }

    if (farming.availableNodes <= 0) {
      return res.status(400).json({ error: "⛔ Нет доступных нод!" });
    }

    if (user.freeOnex === "таймер") {
      return res.status(400).json({ error: "Farming already active" });
    }

    // ✅ Запускаем таймер фарминга
    const farmEndTime = new Date();
    farmEndTime.setSeconds(farmEndTime.getSeconds() + 20); // 20 секунд для теста

    user.freeOnex = "таймер";
    user.farmEndTime = farmEndTime;
    await user.save();

    // ✅ Уменьшаем количество доступных нод
    farming.availableNodes -= 1;
    await farming.save();

    console.log(`✅ Фарминг начат, осталось ${farming.availableNodes} нод`);
    res.json({ success: true, farmEndTime, availableNodes: farming.availableNodes });
  } catch (error) {
    console.error("❌ Ошибка при запуске фарминга:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/get-farming-status", async (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`📌 Проверяем статус фарминга для userId: ${userId}`);

    if (!userId) {
      return res.status(400).json({ error: "❌ userId обязателен!" });
    }

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      console.log(`❌ Пользователь ${userId} не найден в базе!`);
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();

    if (user.freeOnex === "таймер" && new Date(user.farmEndTime) <= now) {
      console.log(`⏳ Таймер истек! Завершаем фарминг для ${userId}...`);

      user.balance += 1;
      user.freeOnex = "зафармлено";
      user.farmEndTime = null; // ✅ Сбрасываем таймер
      await user.save();

      console.log(`✅ Фарм завершен автоматически! Новый баланс: ${user.balance}`);
      return res.json({ success: true, status: "зафармлено", balance: user.balance });
    }

    res.json({ success: true, status: user.freeOnex, farmEndTime: user.farmEndTime });
  } catch (error) {
    console.error("❌ Ошибка при получении статуса фарминга:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/finish-farming", async (req, res) => {
  try {
      const { userId } = req.body;
      console.log(`📌 Запрос на завершение фарминга от пользователя ${userId}`);

      if (!userId) {
          console.log("❌ Ошибка: userId обязателен!");
          return res.status(400).json({ error: "❌ userId обязателен!" });
      }

      let user = await User.findOne({ telegramId: userId });

      if (!user) {
          console.log("❌ Ошибка: Пользователь не найден!");
          return res.status(404).json({ error: "❌ Пользователь не найден!" });
      }

      console.log(`🕒 Текущая дата: ${new Date()} | Завершение фарминга: ${user.farmEndTime}`);

      if (!user.farmEndTime || new Date() < new Date(user.farmEndTime)) {
          console.log("⏳ Фарм еще не завершен. Ожидаем...");
          return res.status(400).json({ error: "⏳ Фарм еще не завершен." });
      }

      if (user.freeOnex === "зафармлено") {
          console.log(`⚠ Фарм уже завершен для пользователя ${userId}, баланс: ${user.balance}`);
          return res.json({ success: true, message: "🎉 Уже зачислено!" });
      }

      user.balance += 1; // ✅ Добавляем +1 TON
      user.freeOnex = "зафармлено"; // ✅ Обновляем статус
      user.farmEndTime = null; // ✅ Сбрасываем таймер
      await user.save();

      console.log(`✅ Фарм завершен! +1 TON добавлено пользователю ${userId}, новый баланс: ${user.balance}`);

      res.json({ success: true, message: "🎉 Фарм завершен!", balance: user.balance });
  } catch (error) {
      console.error("❌ Ошибка при завершении фарминга:", error);
      res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/get-available-nodes", async (req, res) => {
  try {
    let farming = await Farming.findOne(); // ✅ Ищем запись

    if (!farming) {
      farming = new Farming({ availableNodes: 100 }); // ✅ Если записи нет, создаем новую
      await farming.save();
    }

    res.json({ availableNodes: farming.availableNodes });
  } catch (error) {
    console.error("❌ Ошибка при получении доступных нод:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/start-paid-farming", async (req, res) => {
  try {
    const { userId, nodeId } = req.body;

    if (!userId || !nodeId) {
      return res.status(400).json({ error: "userId и nodeId обязательны!" });
    }

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      return res.status(404).json({ error: "Пользователь не найден" });
    }

    // 🔥 Запрашиваем информацию о ноде с админ-бэкенда
    const nodeResponse = await axios.get(`https://adminviber1x-production.up.railway.app/onex-nodes/${nodeId}`);

    if (!nodeResponse.data) {
      return res.status(404).json({ error: "Нода не найдена!" });
    }

    const node = nodeResponse.data;

    // 🔥 Проверяем, запустил ли пользователь уже эту ноду
    if (user.activePaidNodes.some(n => n.nodeId.toString() === nodeId)) {
      return res.status(400).json({ error: "Вы уже запустили эту ноду!" });
    }

    // 🔥 Проверяем баланс пользователя
    if (user.balance < node.stake) {
      return res.status(400).json({ error: "Недостаточно средств!" });
    }

    // ✅ Вычитаем ставку из баланса
    user.balance -= node.stake;

    // ✅ Устанавливаем время окончания фарминга
    const farmEndTime = new Date();
    farmEndTime.setDate(farmEndTime.getDate() + node.days);

    // ✅ Добавляем новую ноду в `activePaidNodes`
    user.activePaidNodes.push({
      nodeId: node._id,
      section: node.section,
      stake: node.stake,
      apy: node.apy,
      days: node.days,
      rewardTon: node.rewardTon,
      rewardOnex: node.rewardOnex,
      farmEndTime: farmEndTime
    });

    await user.save();

    console.log(`✅ Платная нода #${node.index} запущена пользователем ${userId}, окончание ${farmEndTime}`);

    res.json({ success: true, message: "Нода запущена!", farmEndTime, activePaidNodes: user.activePaidNodes });

  } catch (error) {
    console.error("❌ Ошибка при запуске платной ноды:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
    console.log(`🌍 Сервер работает на порту ${PORT}`);
});