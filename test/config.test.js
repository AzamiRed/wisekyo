const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

function environment(overrides = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://localhost/test",
    BOT_ENABLED: "false",
    SESSION_SECRET: "test-session-secret",
    ...overrides,
  };
}

test("production cookies are secure by default but can be disabled for local HTTP", () => {
  assert.equal(loadConfig(environment()).cookie.secure, true);
  assert.equal(loadConfig(environment({ COOKIE_SECURE: "false" })).cookie.secure, false);
});

test("proxy trust is disabled unless explicitly configured", () => {
  assert.equal(loadConfig(environment()).trustProxy, false);
  assert.equal(loadConfig(environment({ TRUST_PROXY: "1" })).trustProxy, 1);
});
