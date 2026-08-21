const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOT_UNAVAILABLE_REPLY,
  createBot,
  startTelegramPolling,
  telegramPollingConflictMessage,
  userFacingGenerationError,
} = require("../src/bot");

function commandUpdate(text, from = { id: 42, is_bot: false, first_name: "Test", username: "tester" }) {
  return {
    update_id: 1,
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: { id: 42, type: "private" },
      from,
      text,
      entities: [{ offset: 0, length: text.length, type: "bot_command" }],
    },
  };
}

function mockTelegramApi(bot, handler) {
  // Telegraf constructs a fresh Telegram client per update, so instance mocks do not apply.
  const apiClientProto = Object.getPrototypeOf(Object.getPrototypeOf(bot.telegram));
  const original = apiClientProto.callApi;
  apiClientProto.callApi = handler;
  return () => {
    apiClientProto.callApi = original;
  };
}

test("temporary thinking message is deleted after image delivery", async () => {
  const calls = [];
  const saved = [];
  const repository = {
    getRandomQuote: async () => ({ text: "Тестовая мудрость" }),
    insertGeneratedImage: async (payload) => {
      saved.push(payload);
      return { id: 1 };
    },
  };
  const bot = createBot({
    token: "test-token",
    repository,
    generateImage: async () => Buffer.from("png"),
  });
  bot.botInfo = { id: 99, is_bot: true, first_name: "wiseKyo", username: "wisekyo_test_bot" };
  const restore = mockTelegramApi(bot, async (method, payload) => {
    calls.push({ method, payload });
    if (method === "sendMessage") {
      return { message_id: 100, date: 1, chat: { id: 42, type: "private" }, text: payload.text };
    }
    if (method === "sendPhoto") {
      return { message_id: 101, date: 1, chat: { id: 42, type: "private" } };
    }
    if (method === "deleteMessage") return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  });

  try {
    await bot.handleUpdate(commandUpdate("/shareyourwisdom"));
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.map((call) => call.method),
    ["sendMessage", "sendPhoto", "deleteMessage"]
  );
  assert.equal(calls[0].payload.text, "мудрость думается");
  assert.equal(calls[2].payload.message_id, 100);
  assert.equal(saved[0].username, "tester");
  assert.equal(saved[0].userId, 42);
  assert.equal(saved[0].displayName, "Test");
  assert.equal(saved[0].chatId, 42);
});

test("temporary thinking message is also deleted when generation fails", async () => {
  const calls = [];
  const logs = [];
  const bot = createBot({
    token: "test-token",
    repository: {
      getRandomQuote: async () => ({ text: "Тестовая мудрость" }),
      insertGeneratedImage: async () => {
        throw new Error("should not be called");
      },
    },
    generateImage: async () => {
      throw new Error("generation failed");
    },
    logger: {
      info: async () => {},
      warn: async () => {},
      error: async (source, message, details) => {
        logs.push({ source, message, details });
      },
    },
  });
  bot.botInfo = { id: 99, is_bot: true, first_name: "wiseKyo", username: "wisekyo_test_bot" };
  const restore = mockTelegramApi(bot, async (method, payload) => {
    calls.push({ method, payload });
    if (method === "sendMessage") {
      return { message_id: calls.length === 1 ? 100 : 101, date: 1, chat: { id: 42, type: "private" }, text: payload.text };
    }
    if (method === "deleteMessage") return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  });

  try {
    await bot.handleUpdate(commandUpdate("/shareyourwisdom"));
  } finally {
    restore();
  }

  assert.deepEqual(
    calls.map((call) => call.method),
    ["sendMessage", "sendMessage", "deleteMessage"]
  );
  assert.equal(calls[1].payload.text, BOT_UNAVAILABLE_REPLY);
  assert.equal(calls[2].payload.message_id, 100);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].source, "bot");
  assert.match(logs[0].message, /Image generation failed/);
});

test("userFacingGenerationError maps OOM and canvas failures", () => {
  assert.match(userFacingGenerationError(new Error("ENOMEM")), /меньшего размера/);
  assert.match(userFacingGenerationError(new Error("Unsupported image type")), /фоновое изображение/);
  assert.equal(userFacingGenerationError(new Error("NO_ACTIVE_IMAGES")), "В базе пока нет активных изображений. Сообщите администратору.");
  assert.equal(userFacingGenerationError(new Error("generation failed")), BOT_UNAVAILABLE_REPLY);
});

test("quote lookup failures reply with the sleeping sage stub", async () => {
  const calls = [];
  const bot = createBot({
    token: "test-token",
    repository: {
      getRandomQuote: async () => {
        throw new Error("db down");
      },
    },
    generateImage: async () => Buffer.from("png"),
    logger: { info: async () => {}, warn: async () => {}, error: async () => {} },
  });
  bot.botInfo = { id: 99, is_bot: true, first_name: "wiseKyo", username: "wisekyo_test_bot" };
  const restore = mockTelegramApi(bot, async (method, payload) => {
    calls.push({ method, payload });
    if (method === "sendMessage") {
      return { message_id: 100, date: 1, chat: { id: 42, type: "private" }, text: payload.text };
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  });

  try {
    await bot.handleUpdate(commandUpdate("/shareyourwisdom"));
  } finally {
    restore();
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.text, BOT_UNAVAILABLE_REPLY);
});

test("startTelegramPolling deletes webhook before launching long polling", async () => {
  const calls = [];
  const bot = {
    telegram: {
      deleteWebhook: async (options) => {
        calls.push({ method: "deleteWebhook", options });
      },
    },
    launch: async (options) => {
      calls.push({ method: "launch", options });
    },
  };

  await startTelegramPolling(bot);

  assert.deepEqual(calls, [
    { method: "deleteWebhook", options: { drop_pending_updates: true } },
    { method: "launch", options: { dropPendingUpdates: true } },
  ]);
});

test("telegramPollingConflictMessage detects 409 getUpdates conflicts", () => {
  const error = new Error("ETELEGRAM: 409 Conflict: terminated by other getUpdates request");
  error.code = 409;
  error.response = { error_code: 409 };
  assert.match(telegramPollingConflictMessage(error), /one running instance/);
  assert.equal(telegramPollingConflictMessage(new Error("timeout")), null);
});

test("polling conflict is logged as a token-collision message", async () => {
  const logs = [];
  const bot = createBot({
    token: "test-token",
    repository: {},
    generateImage: async () => Buffer.from("png"),
    logger: {
      info: async () => {},
      warn: async () => {},
      error: async (source, message, details) => logs.push({ source, message, details }),
    },
  });
  const error = new Error("ETELEGRAM: 409 Conflict: terminated by other getUpdates request");
  error.code = 409;
  await bot.handleError(error, { update: { update_id: 7 } });
  assert.equal(logs.length, 1);
  assert.match(logs[0].message, /BOT_TOKEN/);
});
