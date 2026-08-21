const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger, formatErrorDetails } = require("../src/logger");

test("logger persists entries and swallows repository failures", async () => {
  const entries = [];
  const logger = createLogger({
    insertLog: async (entry) => {
      entries.push(entry);
    },
  });

  await logger.error("bot", "Boom", new Error("stack-here"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, "error");
  assert.equal(entries[0].source, "bot");
  assert.equal(entries[0].message, "Boom");
  assert.match(entries[0].details, /stack-here/);

  const failingLogger = createLogger({
    insertLog: async () => {
      throw new Error("db down");
    },
  });
  await assert.doesNotReject(() => failingLogger.warn("admin", "Still ok"));
});

test("formatErrorDetails includes message and stack", () => {
  const error = new Error("fail");
  error.code = "ERR_TEST";
  const text = formatErrorDetails(error);
  assert.match(text, /fail/);
  assert.match(text, /code=ERR_TEST/);
  assert.match(text, /Error: fail/);
});
