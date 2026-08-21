const { loadConfig } = require("./src/config");
const { createPool } = require("./src/db");
const { ContentRepository } = require("./src/repository");
const { createImageGenerator } = require("./src/image-generator");
const { createAdminApp } = require("./src/admin");
const { createBot, startTelegramPolling, telegramPollingConflictMessage } = require("./src/bot");
const { createLogger } = require("./src/logger");

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.once("listening", () => {
      server.removeListener("error", onError);
      resolve(server);
    });
  });
}

async function start() {
  const config = loadConfig();
  const pool = createPool(config);
  let bot = null;
  let botLaunched = false;
  let server = null;
  try {
    await pool.query("SELECT 1");
    const repository = new ContentRepository(pool);
    const logger = createLogger(repository);
    const generateImage = createImageGenerator({
      repository,
      fontPath: config.fontPath,
      logger,
    });
    const botRuntime = { status: config.botEnabled ? "stopped" : "disabled" };
    const app = createAdminApp({
      config,
      pool,
      repository,
      logger,
      getBotStatus: () => botRuntime.status,
    });

    server = await listen(app, config.port);
    console.log(`wiseKyo admin is listening on port ${config.port}`);
    await logger.info("app", `Admin listening on port ${config.port}`);

    bot = config.botEnabled
      ? createBot({ token: config.botToken, repository, generateImage, logger })
      : null;
    if (bot) {
      try {
        await startTelegramPolling(bot);
        botLaunched = true;
        botRuntime.status = "running";
        console.log("wiseKyo bot is running");
        await logger.info("bot", "Bot started");
      } catch (error) {
        botRuntime.status = "stopped";
        const conflict = telegramPollingConflictMessage(error);
        console.error("wiseKyo bot failed to start; admin remains available:", error);
        await logger.error("bot", conflict || "Bot failed to start", error);
        bot = null;
      }
    }

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received, shutting down...`);
      await logger.info("app", `Shutdown signal ${signal}`);
      if (botLaunched) bot.stop(signal);
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    };
    const handleSignal = (signal) => {
      shutdown(signal).catch((error) => {
        console.error("Shutdown failed:", error);
        process.exitCode = 1;
      });
    };

    process.once("SIGINT", () => handleSignal("SIGINT"));
    process.once("SIGTERM", () => handleSignal("SIGTERM"));

    return { app, bot, pool, server, logger };
  } catch (error) {
    if (botLaunched) bot.stop("STARTUP_ERROR");
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    throw error;
  }
}

if (require.main === module) {
  start().catch((error) => {
    console.error("wiseKyo failed to start:", error);
    process.exitCode = 1;
  });
}

module.exports = { listen, start };