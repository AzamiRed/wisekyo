const path = require("path");
require("dotenv").config({ quiet: true });

function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trustProxy(value) {
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

function loadConfig(env = process.env) {
  const botEnabled = env.BOT_ENABLED !== "false";
  const isProduction = env.NODE_ENV === "production";

  return {
    env: env.NODE_ENV || "development",
    port: positiveInteger(env.PORT, 3000),
    trustProxy: trustProxy(env.TRUST_PROXY),
    databaseUrl: required("DATABASE_URL", env),
    databaseSsl: env.DATABASE_SSL === "true",
    botEnabled,
    botToken: botEnabled ? required("BOT_TOKEN", env) : null,
    sessionSecret: required("SESSION_SECRET", env),
    upload: {
      maxBytes: positiveInteger(env.MAX_IMAGE_BYTES, 10 * 1024 * 1024),
      maxFiles: positiveInteger(env.MAX_IMAGE_FILES, 20),
      maxTotalBytes: positiveInteger(env.MAX_TOTAL_IMAGE_BYTES, 25 * 1024 * 1024),
      maxPixels: positiveInteger(env.MAX_IMAGE_PIXELS, 40_000_000),
    },
    cookie: {
      secure: env.COOKIE_SECURE == null ? isProduction : env.COOKIE_SECURE === "true",
      maxAge: positiveInteger(env.SESSION_MAX_AGE_MS, 12 * 60 * 60 * 1000),
    },
    fontPath: env.FONT_PATH?.trim() || path.join(__dirname, "..", "fonts", "Impact.ttf"),
  };
}

module.exports = { loadConfig };
