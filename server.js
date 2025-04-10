require('dotenv').config();
const axios = require("axios");
const express = require("express");
const mongoose = require("mongoose");
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const cors = require("cors");

const DATABASE = process.env.DATABASE;
const User = require("./models/User");
const Farming = require("./models/Farming"); // ✅ Подключаем схему Farming
const Task = require("./models/Task");
const Config = require("./models/Config");

const TON_API_KEY = process.env.TON_API_KEY;
let WALLET_ADDRESS = "";

async function loadWalletAddress() {
  try {
    const config = await Config.findOne();
    if (config?.depositAddress) {
      WALLET_ADDRESS = config.depositAddress;
    } else {
      console.warn("⚠️ Адрес кошелька не найден в базе. Используется значение по умолчанию.");
      WALLET_ADDRESS = "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs";
    }
  } catch (err) {
    console.error("❌ Ошибка загрузки адреса из базы:", err);
    WALLET_ADDRESS = "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs";
  }
}

const ADMIN_API_URL = process.env.ADMIN_API_URL;

const NOTIFY_BOT_URL = process.env.NOTIFY_BOT_URL;

// 📦 Обычные уведомления
async function notifyToNotifyBot(type, payload) {
  try {
    const res = await fetch(`${NOTIFY_BOT_URL}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload })
    });

    if (!res.ok) throw new Error(`Ошибка отправки уведомления: ${res.status}`);
  } catch (err) {
    console.error("❌ Ошибка отправки в notify-бота:", err);
  }
}

const generateReferralCode = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// 👨‍💻 Уведомления в админ-бота с кнопками
async function notifyToAdminBot(type, payload) {
  try {
    const res = await fetch(`${ADMIN_API_URL}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload })
    });

    if (!res.ok) throw new Error(`Ошибка отпраки уведомления: ${res.status}`);
  } catch (err) {
    console.error("❌ Ошибка отправки в admin-бота:", err);
  }
}

async function notify(type, payload) {
  const { userId, username, ...rest } = payload;

  if (type === "withdraw_order") {
    return notifyToAdminBot(type, { userId, username, ...rest });
  }

  return notifyToNotifyBot(type, { userId, username, ...rest });
}

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
        await loadWalletAddress();
        API_URL = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions`;
        
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
                processedTransactions: [],
                refCode: generateReferralCode()
            });

            await user.save();
        }

        if (user.processedTransactions.includes(txHash)) {
            console.log(`⚠ Транзакция ${txHash} уже была обработана. Пропускаем.`);
            return;
        }

        user.balance += amountTON;
        user.processedTransactions.push(txHash);

        user.depositHistory.push({
          amount: amountTON,
          txHash,
          createdAt: new Date()
        });

        await user.save();

        const inviterDisplay = user?.referredBy || "—";
        let inviter = null;
        if (user.referredBy) {
          const refCode = user.referredBy;
          inviter = await User.findOne({
            $or: [
              { username: refCode.replace(/^@/, "") },
              { telegramId: refCode.replace(/^ID:/, "") }
            ]
          });
        }

        const tonPercent = inviter?.tonPercent || 0;
        const onexPercent = inviter?.onexPercent || 0;
        
        const royaltyTon = parseFloat((amountTON * tonPercent / 100).toFixed(2));
        const royaltyOnex = parseFloat((amountTON * onexPercent / 100).toFixed(2));
        
        if (inviter) {
          inviter.balance += royaltyTon;
          inviter.onexBalance = (inviter.onexBalance || 0) + royaltyOnex;
        
          inviter.referralRewards = inviter.referralRewards || [];
        
          const existing = inviter.referralRewards.find(r => r.telegramId === user.telegramId);
          if (existing) {
            existing.totalRewardTon += royaltyTon;
            existing.totalRewardOnex = (existing.totalRewardOnex || 0) + royaltyOnex;
          } else {
            inviter.referralRewards.push({
              telegramId: user.telegramId,
              totalRewardTon: royaltyTon,
              totalRewardOnex: royaltyOnex
            });
          }
        
          await inviter.save();
        }
        
        await notifyToAdminBot("new_deposit", {
          userId,
          username: user.username,
          amount: amountTON,
          txHash,
          inviterDisplay,
          royaltyTon,
          royaltyOnex
        });
        console.log(`💰 Баланс пользователя ${userId} обновлён: +${amountTON} TON`);


        await notify("deposit", { userId, username: user.username, amount: amountTON });

    } catch (error) {
        console.error("❌ Ошибка при обработке тразакции:", error);
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

connectDB().then(async () => {
  await loadWalletAddress();
  API_URL = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions`;
  console.log("✅ WALLET_ADDRESS загружен:", WALLET_ADDRESS);
  console.log("✅ API_URL установлен:", API_URL);
});

const app = express();

app.use(cors({ origin: "https://viber-redirect.netlify.app" })); // Указываем домен фронта
app.use(express.json()); // Для работы с JSON

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const FRONTEND_URL = "https://viber-redirect.netlify.app";

bot.onText(/\/start/, async (msg) => {
    const skipSavingUser = true; // ⬅ Временно отключаем сохранение пользователей
    if (skipSavingUser) {
      const chatId = msg.chat.id;
      const languageCode = msg.from.language_code || 'en';
      const isRussian = languageCode.startsWith('ru');
  
      const caption = isRussian ? 'Вы запустили бота.' : 'Bot started.';
      const buttonText = isRussian ? 'Открыть приложение' : 'Open App';
  
      const imagePath = path.join(__dirname, 'images', 'logo.onex.png');
      await bot.sendPhoto(chatId, imagePath, {
          caption,
          reply_markup: {
              inline_keyboard: [
                  [{ text: buttonText, web_app: { url: FRONTEND_URL } }]
              ]
          }
      });
      return;
    }
    console.log("📌 Полное сообщение от пользователя:", msg);

    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || null; // ✅ Берём `username`, если есть
    const languageCode = msg.from.language_code || 'en';
    const isRussian = languageCode.startsWith('ru');

    const payload = msg.text?.split(" ") || [];
    const refCode = payload.length > 1 ? payload[1] : null;
    if (refCode === "bot_test") {
        console.log("🤖 Тестовый запуск — MAU для накрутки. Ничего не сохраняем.");

        const caption = isRussian ? 'Вы запустили бота.' : 'Bot started.';
        const buttonText = isRussian ? 'Открыть приложение' : 'Open App';

        const imagePath = path.join(__dirname, 'images', 'logo.onex.png');
        await bot.sendPhoto(chatId, imagePath, {
            caption,
            reply_markup: {
                inline_keyboard: [
                    [{ text: buttonText, web_app: { url: FRONTEND_URL } }]
                ]
            }
        });
        return;
    }
    const frontendUrl = `${FRONTEND_URL}/?userId=${userId}${refCode ? `&ref=${refCode}` : ""}`;
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
                username: username,
                balance: 0.00,
                processedTransactions: [],
                refCode: generateReferralCode()
            });

            await user.save();
            console.log(`✅ Новый пользователь ${userId} добавлен в базу данных`);
        } else {
            console.log(`🔄 Пользователь ${userId} уже зарегистрирован.`);

          // ✅ Если username изменился, обновляем его в базе
          if (username && user.username !== username) {
            user.username = username;
            await user.save();
            console.log(`✅ Обновлен username для пользователя ${userId}: ${username}`);
          }
        }


        await bot.sendPhoto(chatId, imagePath, {
            caption,
            reply_markup: {
                inline_keyboard: [
                    [{ text: buttonText, web_app: { url: frontendUrl } }]
                ]
            }
        });

        await notify("start", {
          userId,
          username
        });

    } catch (error) {
        console.error('❌ Ошибка при обработке команды /start:', error);
        bot.sendMessage(chatId, isRussian
            ? 'Произошла ошибка при обработке команды.'
            : 'An error occurred while processing the command.');
    }
});

console.log('Бот запущен. Ожидаем команды /start...');

app.post("/register-user", async (req, res) => {
  try {
    const { telegramId, username, ref } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    let user = await User.findOne({ telegramId });

    if (!user) {
      console.log(`🚀 Новый пользователь ${telegramId}, создаём...`);
    
    const refCode = generateReferralCode();
    const inviter = ref ? await User.findOne({ refCode: ref }) : null;
    const referredBy = inviter ? (inviter.username ? `@${inviter.username}` : `ID:${inviter.telegramId}`) : null;
    
      user = new User({
        telegramId,
        username: username || null,
        balance: 0.00,
        walletAddress: null,
        refCode,
        referredBy
      });
    
      await user.save();
    
    // ✅ Добавляем этого пользователя в массив рефералов пригласившего
      if (ref) {
        const inviter = await User.findOne({ refCode: ref });
        if (inviter) {
          const display = username ? `@${username}` : `ID: ${telegramId}`;
          if (!inviter.referrals.includes(display)) {
            inviter.referrals.push(display);
            await inviter.save();
          }
        }
      }
    
    await notify("start", {
      userId: telegramId,
      username: user.username,
      referredBy: user.referredBy || null
    });
    } else {
      console.log(`🔄 Пользователь ${telegramId} уже зарегистрирован.`);
 
      if (username && user.username !== username) {
        user.username = username;
        await user.save();
        console.log(`✅ Обновлен username для пользователя ${telegramId}: ${username}`);
      }
      
      if (ref && !user.referredBy) {
        const inviter = await User.findOne({ refCode: ref });
        const referredBy = inviter ? (inviter.username ? `@${inviter.username}` : `ID:${inviter.telegramId}`) : null;
        user.referredBy = referredBy;
        await user.save();

        if (inviter) {
          const display = user.username ? `@${user.username}` : `ID:${user.telegramId}`;
          if (!inviter.referrals.includes(display)) {
            inviter.referrals.push(display);
            await inviter.save();
          }
        }
      }
 
      await notify("start", {
        userId: telegramId,
        username: user.username,
        referredBy: user.referredBy || null
      });
    }

    res.json({
      success: true,
      userId: user.telegramId,
      username: user.username,
      refCode: user.refCode,
      referredBy: user.referredBy
    });
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

      res.json({
        balance: parseFloat(user.balance),
        onexBalance: parseFloat(user.onexBalance || 0)
      });
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
      farming = new Farming({ availableNodes: 100, totalNodes: 100 }); // ✅ Создаем запись, если ее нет
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
    farmEndTime.setHours(farmEndTime.getHours() + 12); // 20 секунд для теста

    user.freeOnex = "таймер";
    user.farmEndTime = farmEndTime;
    await user.save();

    // ✅ Уменьшаем количество доступных нод
    farming.availableNodes -= 1;
    await farming.save();

    await notify("free", { userId, username: user.username });

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

    res.json({ availableNodes: farming.availableNodes, totalNodes: farming.totalNodes });
  } catch (error) {
    console.error("❌ Ошибка при получении доступных нод:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/start-paid-farming", async (req, res) => {
  try {
    const { userId, nodeId } = req.body;

    if (!userId || !nodeId) {
      return res.status(400).json({ error: "❌ userId и nodeId обязательны!" });
    }

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      return res.status(404).json({ error: "❌ Пользователь не найден!" });
    }

    let node = await getNodeById(nodeId);

    if (!node) {
      return res.status(404).json({ error: "❌ Нода не найдена!" });
    }

    // ✅ Проверяем, была ли эта нода уже зафармлена
    const alreadyFarmed = user.purchasedPaidNodes.some(n => n.nodeId.toString() === nodeId);
    if (alreadyFarmed) {
      return res.status(400).json({ error: "Вы уже фармили эту ноду!" });
    }

    // ✅ Проверяем, активна ли уже эта нода у юзера
    if (user.activePaidNodes.some(n => n.nodeId.toString() === nodeId)) {
      return res.status(400).json({ error: "Вы уже запустили эту ноду!" });
    }

    if (user.balance < node.stake) {
      return res.status(400).json({ error: "Недостаточно средств!" });
    }

    // Вычитаем ставку из баланса
    user.balance -= node.stake;

    const farmEndTime = new Date();
    farmEndTime.setSeconds(farmEndTime.getSeconds() + node.days * 86400); // Переводим дни в секунды

    // ✅ Добавляем ноду в список активных
    user.activePaidNodes.push({
      nodeId: node._id,
      section: node.section,
      stake: node.stake,
      apy: node.apy,
      days: node.days,
      rewardTon: node.rewardTon,
      rewardOnex: node.rewardOnex,
      farmEndTime: farmEndTime,
      status: "таймер"
    });

    await user.save();

    await notify("paid", { userId, username: user.username, nodeIndex: node.index, stake: node.stake });

    console.log(`✅ Платная нода ${node._id} запущена пользователем ${userId}, окончание фарминга: ${farmEndTime}`);

    res.json({
      success: true,
      message: "Нода запущена!",
      farmEndTime,
      activePaidNodes: user.activePaidNodes
    });

  } catch (error) {
    console.error("❌ Ошибка при запуске платного фарминга:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/get-active-paid-nodes", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId обязателен!" });
    }

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ activePaidNodes: user.activePaidNodes });
  } catch (error) {
    console.error("❌ Ошибка при получении активных платных нод:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/get-paid-farming-status", async (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`📌 Проверяем статус платных нод для userId: ${userId}`);

    if (!userId) {
      return res.status(400).json({ error: "❌ userId обязателен!" });
    }

    let user = await User.findOne({ telegramId: userId });

    if (!user) {
      console.log(`❌ Пользователь ${userId} не найден в базе!`);
      return res.status(404).json({ error: "User not found" });
    }

    const now = new Date();
    let totalReward = 0;
    let totalRewardOnex = 0;
    let updatedNodes = [];

    for (const node of user.activePaidNodes) {
      if (node.status !== "зафармлено" && new Date(node.farmEndTime) <= now) {
        node.status = "зафармлено";
        await user.save();
        
        let rewardTon = node.stake + node.rewardTon;
        let rewardOnex = node.rewardOnex || 0;
        
        totalReward += rewardTon;
        totalRewardOnex += rewardOnex;
        
        console.log(`✅ Нода ${node.nodeId} завершена! Начисляем ${rewardTon} TON и ${rewardOnex} ONEX.`);
        
        user.purchasedPaidNodes.push({
          nodeId: node.nodeId,
          stake: node.stake,
          rewardTon: node.rewardTon,
          rewardOnex: node.rewardOnex || 0,
          farmEndTime: node.farmEndTime,
          status: "зафармлено",
          createdAt: node.farmEndTime
        });
      } else {
        updatedNodes.push(node);
      }
    }

    if (totalReward > 0 || totalRewardOnex > 0) {
      console.log(`💰 ДО обновления: Баланс TON: ${user.balance}, ONEX: ${user.onexBalance}`);
    
      if (totalReward > 0) {
        user.balance += totalReward;
      }
    
      if (totalRewardOnex > 0) {
        user.onexBalance += totalRewardOnex;
      }
      
      // ✅ Начисляем ONEX роялти пригласителю
      if (user.referredBy && totalRewardOnex > 0) {
        const refCode = user.referredBy;
        const inviter = await User.findOne({
          $or: [
            { username: refCode.replace(/^@/, "") },
            { telegramId: refCode.replace(/^ID:/, "") }
          ]
        });
      
        if (inviter) {
          const onexPercent = inviter.onexPercent || 0;
          const royaltyOnex = parseFloat((totalRewardOnex * onexPercent / 100).toFixed(2));
      
          inviter.onexBalance = (inviter.onexBalance || 0) + royaltyOnex;
      
          inviter.referralRewards = inviter.referralRewards || [];
          const existingRef = inviter.referralRewards.find(r => r.telegramId === user.telegramId);
          if (existingRef) {
            existingRef.totalRewardOnex = (existingRef.totalRewardOnex || 0) + royaltyOnex;
          } else {
            inviter.referralRewards.push({
              telegramId: user.telegramId,
              username: user.username,
              totalRewardTon: 0,
              totalRewardOnex: royaltyOnex
            });
          }
      
          await inviter.save();
        }
      }
    
      user.activePaidNodes = updatedNodes; // ✅ Убираем завершенные ноды из активных
      console.log(`💰 ПОСЛЕ обновления: Баланс TON: ${user.balance}, ONEX: ${user.onexBalance}`);
    }
    await user.save();

    res.json({ success: true, activePaidNodes: user.activePaidNodes, balance: user.balance, purchasedPaidNodes: user.purchasedPaidNodes  });
  } catch (error) {
    console.error("❌ Ошибка при получении статуса платного фарминга:", error);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/get-deposit-history", async (req, res) => {
  const { userId } = req.query;

  if (!userId) return res.status(400).json({ error: "userId is required" });

  const user = await User.findOne({ telegramId: userId });

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ history: user.depositHistory || [] });
});

// 2. Роут: Создание ордера на вывод
app.post("/create-withdraw-order", async (req, res) => {
  try {
    const { userId, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!userId || isNaN(parsedAmount)) {
      return res.status(400).json({ error: "userId и сумма обязательны" });
    }

    if (parsedAmount < 1) {
      return res.status(400).json({ error: "Минимум 1 TON" });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    if (user.balance < parsedAmount) {
      return res.status(400).json({ error: "Недостаточно средств" });
    }

    const hasPending = user.withdrawOrders.some(order => order.status === "в обработке");
    if (hasPending) {
      return res.status(400).json({ error: "У вас уже есть активный запрос на вывод" });
    }

    user.balance -= parsedAmount;

    const newOrder = {
      amount: parsedAmount,
      status: "в обработке",
      createdAt: new Date(),
    };

    user.withdrawOrders.unshift(newOrder);
    await user.save();

    // 📩 Отправка администратору через notify
    await notify("withdraw_order", {
      userId,
      username: user.username,
      amount: parsedAmount,
      deposits: user.depositHistory,
      purchased: user.purchasedPaidNodes,
      withdrawOrders: user.withdrawOrders, 
      orderIndex: 0,
      balance: user.balance,
      onexBalance: user.onexBalance,  
      walletAddress: user.walletAddress,
      freeOnex: user.freeOnex,
      active: user.activePaidNodes,
      referredBy: user.referredBy,
      hasAmbassadorAccess: user.hasAmbassadorAccess || false,
      totalEarnedFromReferrals: user.totalEarnedFromReferrals || 0,
    });

    res.json({ success: true, order: newOrder, balance: user.balance });
  } catch (err) {
    console.error("❌ Ошибка создания ордера:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// 3. Получение ордеров пользователя
app.get("/get-withdraw-orders", async (req, res) => {
  try {
    const { userId } = req.query;
    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ orders: user.withdrawOrders || [] });
  } catch (err) {
    console.error("❌ Ошибка получения ордеров:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// 4. Обработка нажатий админом в боте (через notify-бэк)
// ✅ approve-withdraw/:userId/:index
app.post("/approve-withdraw", async (req, res) => {
  const { userId, index } = req.body;
  const user = await User.findOne({ telegramId: userId });

  if (!user || !user.withdrawOrders[index]) {
    return res.status(404).json({ error: "Order not found" });
  }

  user.withdrawOrders[index].status = "выполнен";
  await user.save();
  res.json({ success: true });
});

// ❌ reject-withdraw/:userId/:index
app.post("/reject-withdraw", async (req, res) => {
  const { userId, index } = req.body;
  const user = await User.findOne({ telegramId: userId });

  if (!user || !user.withdrawOrders[index]) {
    return res.status(404).json({ error: "Order not found" });
  }

  const refundAmount = user.withdrawOrders[index].amount;
  user.balance += refundAmount;
  user.withdrawOrders[index].status = "отклонен";
  await user.save();

  res.json({ success: true });
});

app.post("/check-subscription", async (req, res) => {
  const { userId, chatId } = req.body;

  if (!userId || !chatId) {
    return res.status(400).json({ error: "userId и chatId обязательны!" });
  }

  try {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${chatId}&user_id=${userId}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.ok && data.result) {
      const status = data.result.status;
      res.json({ isSubscribed: status !== "left" });
    } else {
      res.status(500).json({ error: "Не удалось получить статус подписки. Убедитесь, что бот является админом в указанном канале или чате." });
    }
  } catch (err) {
    console.error("❌ Ошибка при проверке подписки:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/mark-task-completed", async (req, res) => {
  try {
    const { userId, taskId } = req.body;

    if (!userId || !taskId) {
      return res.status(400).json({ error: "userId и taskId обязательны!" });
    }

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ error: "Задание не найдено" });


    if (!user.completedTasks.includes(taskId)) {
      user.completedTasks.push(taskId);
      user.onexBalance += task.points;
      
      // ✅ Автоматически начисляем ONEX роялти пригласителю
      if (user.referredBy) {
        const refCode = user.referredBy;
        const inviter = await User.findOne({
          $or: [
            { username: refCode.replace(/^@/, "") },
            { telegramId: refCode.replace(/^ID:/, "") }
          ]
        });
 
        if (inviter) {
          const onexPercent = inviter.onexPercent || 0;
          const royaltyOnex = parseFloat((task.points * onexPercent / 100).toFixed(2));
 
          inviter.onexBalance = (inviter.onexBalance || 0) + royaltyOnex;
 
          inviter.referralRewards = inviter.referralRewards || [];
          const existingRef = inviter.referralRewards.find(r => r.telegramId === user.telegramId);
          if (existingRef) {
            existingRef.totalRewardOnex = (existingRef.totalRewardOnex || 0) + royaltyOnex;
          } else {
            inviter.referralRewards.push({
              telegramId: user.telegramId,
              username: user.username,
              totalRewardOnex: royaltyOnex,
              totalRewardTon: 0
            });
          }
 
          await inviter.save();
        }
      }
      
      await user.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Ошибка при отметке задания выполненным:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/get-completed-tasks", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) return res.status(400).json({ error: "userId обязателен!" });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    res.json({ completed: user.completedTasks || [] });
  } catch (error) {
    console.error("❌ Ошибка при получении выполненных заданий:", error);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/get-user-tasks", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) return res.status(400).json({ error: "userId обязателен!" });

    const user = await User.findOne({ telegramId: userId });
    const allTasks = await Task.find();

    if (!user) return res.status(404).json({ error: "User not found" });

    const completed = user.completedTasks || [];

    const tasks = allTasks.map(task => ({
      chatId: task.chatId,
      status: completed.includes(task._id.toString())
    }));

    res.json({ tasks });
  } catch (err) {
    console.error("❌ Ошибка получения заданий:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/get-referrals", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: "userId is required" });

    const user = await User.findOne({ telegramId: userId });
    if (!user) return res.status(404).json({ error: "User not fond" });

    const refId = user.username ? `@${user.username}` : `ID:${user.telegramId}`;

    const referrals = await User.find({ referredBy: refId });

    const list = referrals.map(ref => {
      const rewardInfo = user.referralRewards?.find(r => r.telegramId === ref.telegramId);
      return {
        username: ref.username ? `@${ref.username}` : `ID:${ref.telegramId}`,
        rewardInTon: rewardInfo ? rewardInfo.totalRewardTon : 0,
        rewardInOnex: rewardInfo ? rewardInfo.totalRewardOnex || 0 : 0
      };
    });

    res.json({ referrals: list, count: list.length });
  } catch (err) {
    console.error("❌ Ошибка при получении рефералов:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// сервер: server.js
app.get("/get-ref-code", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const user = await User.findOne({ telegramId: userId });
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({ refCode: user.refCode });
});

app.get("/get-ambassador-data", async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const user = await User.findOne({ telegramId: userId });
  if (!user) return res.status(404).json({ error: "User not fund" });

  res.json({
    hasAccess: user.hasAmbassadorAccess || false,
    tonPercent: user.tonPercent || 0,
    onexPercent: user.onexPercent || 0
  });
});

app.get("/admin/get-config", async (req, res) => {
  try {
    let config = await Config.findOne();
    if (!config) {
      config = new Config({ depositAddress: "0QBkLTS-N_Cpr4qbHMRXIdVYhWMs3dQVpGSQEl44VS3SNwNs" }); // дефолтный
      await config.save();
    }
    res.json(config);
  } catch (err) {
    console.error("❌ Ошибка при получении конфигурации:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/update-config", async (req, res) => {
  try {
    const { depositAddress } = req.body;
    if (!depositAddress || typeof depositAddress !== "string") {
      return res.status(400).json({ error: "depositAddress is required and must be a string" });
    }

    let config = await Config.findOne();
    if (!config) {
      config = new Config({ depositAddress });
    } else {
      config.depositAddress = depositAddress;
    }

    await config.save();
    res.json({ success: true, depositAddress });
  } catch (err) {
    console.error("❌ Ошибка при обновлении конфигурации:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => {
    console.log(`🌍 Сервер работает на порту ${PORT}`);
});

app.post("/admin/update-nodes", async (req, res) => {
  try {
    const { availableNodes, totalNodes } = req.body;

    const farming = await Farming.findOne();
    if (!farming) {
      return res.status(404).json({ error: "Farming config not found" });
    }

    if (typeof availableNodes === "number") {
      farming.availableNodes = availableNodes;
    }

    if (typeof totalNodes === "number") {
      farming.totalNodes = totalNodes;
    }

    await farming.save();
    res.json({ success: true, availableNodes: farming.availableNodes, totalNodes: farming.totalNodes });
  } catch (err) {
    console.error("Ошибка при обновлении нод:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});