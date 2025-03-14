const TelegramBot = require('node-telegram-bot-api');
const path = require('path');

// Токен Telegram бота
const token = '7978525169:AAELA1uK50fy8dyZprGhrLDPxxXUD3jVros'; // Вставьте сюда ваш токен бота
const bot = new TelegramBot(token, { polling: true });

// Фронтенд URL
const FRONTEND_URL = 'https://viber-redirect.netlify.app'; // Вставьте сюда URL вашео фронтенда

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const languageCode = msg.from.language_code || 'en'; // Язык пользователя
  const isRussian = languageCode.startsWith('ru'); // Проверяем, русский ли язык

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