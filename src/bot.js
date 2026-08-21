const { Markup, Telegraf } = require("telegraf");

const BOT_UNAVAILABLE_REPLY = "мудрец уснул. чтобы разбудить пишите @azami_red";

function telegramDisplayName(from = {}) {
  const parts = [from.first_name, from.last_name].filter(Boolean);
  return parts.join(" ").trim() || null;
}

function telegramPollingConflictMessage(error) {
  const code = error?.response?.error_code ?? error?.code;
  const message = String(error?.message || error?.description || "");
  if (code === 409 || /409|Conflict.*getUpdates|ETELEGRAM: 409/i.test(message)) {
    return "Another process is already polling this BOT_TOKEN. Keep only one running instance.";
  }
  return null;
}

async function startTelegramPolling(bot) {
  await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  return bot.launch({ dropPendingUpdates: true });
}

function userFacingGenerationError(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  if (message === "NO_ACTIVE_IMAGES") {
    return "В базе пока нет активных изображений. Сообщите администратору.";
  }
  if (message === "EMPTY_TEXT") {
    return "Нужен текст для генерации мудрости.";
  }
  if (/ENOMEM|heap|allocation|out of memory/i.test(message) || code === "ERR_MEMORY_ALLOCATION_FAILED") {
    return "Фон слишком большой для генерации. Загрузите изображение меньшего размера.";
  }
  if (/JPEG|PNG|decode|Unsupported image|Image given has not completed loading/i.test(message)) {
    return "Не удалось прочитать фоновое изображение. Проверьте загруженные фоны.";
  }
  return BOT_UNAVAILABLE_REPLY;
}

async function replyUnavailable(ctx, logger) {
  if (!ctx?.reply) return;
  try {
    await ctx.reply(BOT_UNAVAILABLE_REPLY);
  } catch (replyError) {
    await logger.error("bot", "Failed to send unavailable reply", replyError);
  }
}

function wrapHandler(handler, logger) {
  return async (ctx, next) => {
    try {
      await handler(ctx, next);
    } catch (error) {
      await logger.error("bot", "Unhandled handler error", error);
      await replyUnavailable(ctx, logger);
    }
  };
}

function createBot({ token, repository, generateImage, logger }) {
  const bot = new Telegraf(token);
  const lastMessages = new Map();
  const awaitingInput = new Set();
  const log = logger || {
    info: async () => {},
    warn: async () => {},
    error: async (source, message, details) => console.error(`[${source}] ${message}`, details || ""),
  };

  async function sendGeneratedImage(ctx, text, source) {
    let thinkingMessage;
    try {
      thinkingMessage = await ctx.reply("мудрость думается");
      const normalizedText = String(text).replace(/\s+/g, " ").trim().slice(0, 1000);
      const image = await generateImage(normalizedText);
      const from = ctx.from || {};
      await repository.insertGeneratedImage({
        data: image,
        text: normalizedText,
        source,
        chatId: ctx.chat.id,
        userId: from.id ?? null,
        username: from.username ? String(from.username).slice(0, 64) : null,
        displayName: telegramDisplayName(from),
      });
      await ctx.replyWithPhoto({ source: image });
    } catch (error) {
      await log.error("bot", `Image generation failed (${source})`, error);
      return ctx.reply(userFacingGenerationError(error));
    } finally {
      if (thinkingMessage) {
        await ctx.telegram
          .deleteMessage(ctx.chat.id, thinkingMessage.message_id)
          .catch((error) => log.warn("bot", "Failed to delete thinking message", error));
      }
    }
  }

  async function shareRandomWisdom(ctx) {
    try {
      const quote = await repository.getRandomQuote();
      if (!quote) return ctx.reply("В базе пока нет активных цитат.");
      return sendGeneratedImage(ctx, quote.text, "random");
    } catch (error) {
      await log.error("bot", "Quote lookup failed", error);
      return ctx.reply(BOT_UNAVAILABLE_REPLY);
    }
  }

  async function acceptChatWisdom(ctx) {
    const text = lastMessages.get(ctx.chat.id);
    if (!text) return ctx.reply("В чате пока нет мудрости для генерации.");
    return sendGeneratedImage(ctx, text, "chat");
  }

  async function requestOwnWisdom(ctx) {
    awaitingInput.add(ctx.chat.id);
    return ctx.reply("Введите текст мудрости, чтобы я сгенерировал изображение:");
  }

  bot.command(
    "start",
    wrapHandler(
      (ctx) =>
        ctx.reply(
          `Привет! Я Мудрый Кё 🤍
Этот бот помогает делиться мудростью через красивые изображения.

📜 Получить случайную мудрость из базы
💌 Принять последнее сообщение в чате
✍️ Отправить свою мудрость`,
          Markup.keyboard([
            ["Запросить мудрость"],
            ["Дать мудрость чата"],
            ["Дать свою мудрость"],
          ]).resize()
        ),
      log
    )
  );

  bot.hears("Запросить мудрость", wrapHandler(shareRandomWisdom, log));
  bot.command("shareyourwisdom", wrapHandler(shareRandomWisdom, log));
  bot.hears("Дать мудрость чата", wrapHandler(acceptChatWisdom, log));
  bot.command("acceptourwisdom", wrapHandler(acceptChatWisdom, log));
  bot.hears("Дать свою мудрость", wrapHandler(requestOwnWisdom, log));
  bot.command("acceptmywisdom", wrapHandler(requestOwnWisdom, log));

  bot.on(
    "message",
    wrapHandler(async (ctx) => {
      const chatId = ctx.chat.id;
      if (awaitingInput.has(chatId)) {
        awaitingInput.delete(chatId);
        if (!ctx.message?.text) return ctx.reply("Нужен текст для генерации мудрости.");
        return sendGeneratedImage(ctx, ctx.message.text, "own");
      }
      if (ctx.message?.text && !ctx.message.text.startsWith("/")) {
        lastMessages.set(chatId, ctx.message.text);
      }
    }, log)
  );

  bot.catch(async (error, ctx) => {
    const conflict = telegramPollingConflictMessage(error);
    if (conflict) {
      await log.error("bot", conflict, error);
      return;
    }
    await log.error("bot", `Unhandled bot error for update ${ctx?.update?.update_id ?? "?"}`, error);
    await replyUnavailable(ctx, log);
  });

  return bot;
}

module.exports = {
  BOT_UNAVAILABLE_REPLY,
  createBot,
  startTelegramPolling,
  telegramDisplayName,
  telegramPollingConflictMessage,
  userFacingGenerationError,
};
