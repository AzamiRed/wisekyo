const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const { createCanvas } = require("canvas");
const session = require("express-session");
const request = require("supertest");
const { createAdminApp, formatGeneratorUser, shortenFilename } = require("../src/admin");

function extractCsrf(html) {
  const match = html.match(/name="_csrf" value="([a-f0-9]+)"/);
  assert.ok(match, "CSRF field should be rendered");
  return match[1];
}

async function fixture() {
  const quotes = [];
  const images = [];
  const generatedImages = [{
    id: 1,
    data: Buffer.from("generated-png"),
    text: "Сохранённая мудрость",
    source: "random",
    chat_id: "42",
    user_id: 42,
    username: "wise_user",
    display_name: "Wise User",
    created_at: new Date(),
  }];
  const logs = [{
    id: 1,
    level: "error",
    source: "bot",
    message: "Image generation failed",
    details: "ENOMEM",
    created_at: new Date(),
  }];
  const admins = [{
    id: 1,
    username: "admin",
    password_hash: await bcrypt.hash("very-long-test-password", 4),
    created_at: new Date(),
  }];
  const repository = {
    findAdmin: async (username) =>
      admins.find((item) => item.username === String(username || "").toLowerCase()) || null,
    listAdmins: async () =>
      admins.map(({ id, username, created_at }) => ({ id, username, created_at })),
    countAdmins: async () => admins.length,
    createAdmin: async ({ username, passwordHash }) => {
      const account = {
        id: admins.length + 1,
        username,
        password_hash: passwordHash,
        created_at: new Date(),
      };
      admins.push(account);
      return { id: account.id, username: account.username, created_at: account.created_at };
    },
    deleteAdmin: async (id) => {
      const index = admins.findIndex((item) => item.id === Number(id));
      if (index === -1) return false;
      admins.splice(index, 1);
      return true;
    },
    listQuotes: async () => quotes,
    insertQuotes: async (values) => {
      const inserted = values.map((text, index) => ({ id: index + 1, text }));
      quotes.push(...inserted.map((item) => ({ ...item, active: true })));
      return inserted;
    },
    setQuoteActive: async () => true,
    deleteQuote: async () => true,
    listImages: async () => images,
    getImage: async (id) => images.find((item) => item.id === Number(id)) || null,
    insertImage: async ({ originalName, mimeType, data }) => {
      const image = {
        id: images.length + 1,
        original_name: originalName,
        mime_type: mimeType,
        data,
        active: true,
      };
      images.push(image);
      return image;
    },
    setImageActive: async () => true,
    deleteImage: async () => true,
    listGeneratedImages: async () => generatedImages,
    getGeneratedImage: async (id) =>
      generatedImages.find((item) => item.id === Number(id)) || null,
    deleteGeneratedImage: async (id) => {
      const index = generatedImages.findIndex((item) => item.id === Number(id));
      if (index === -1) return false;
      generatedImages.splice(index, 1);
      return true;
    },
    listLogs: async ({ level } = {}) =>
      level ? logs.filter((item) => item.level === level) : [...logs],
    clearLogs: async () => {
      logs.length = 0;
    },
  };
  const config = {
    sessionSecret: "test-secret-that-is-long-enough-for-tests",
    cookie: { secure: false, maxAge: 60_000 },
    upload: { maxBytes: 1024 * 1024, maxFiles: 5 },
  };
  const pool = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
  const app = createAdminApp({
    config,
    pool,
    repository,
    sessionStore: new session.MemoryStore(),
  });
  return { admins, app, generatedImages, images, logs, quotes };
}

async function loginAsAdmin(agent) {
  const loginPage = await agent.get("/admin/login").expect(200);
  const loginCsrf = extractCsrf(loginPage.text);
  await agent
    .post("/admin/login")
    .type("form")
    .send({ _csrf: loginCsrf, username: "admin", password: "very-long-test-password" })
    .expect(302)
    .expect("Location", "/admin/quotes");
}

test("shortenFilename truncates long image names for the admin table", () => {
  const longName =
    "Z7TCJPMKOMouo0L4WtA5SsfqHL-pJf78goCm4mCYeNwlo5cwB-asUHr4DC336IqzUr_jU2T5a.png";
  const shortName = shortenFilename(longName, 36);
  assert.ok(shortName.length <= 36);
  assert.match(shortName, /…/);
  assert.match(shortName, /\.png$/);
  assert.equal(shortenFilename("short.png"), "short.png");
});

test("health reports database status and bot runtime", async () => {
  const { app } = await fixture();
  const unknown = await request(app).get("/health").expect(200);
  assert.deepEqual(unknown.body, { status: "ok", bot: "unknown" });

  const config = {
    sessionSecret: "test-secret-that-is-long-enough-for-tests",
    cookie: { secure: false, maxAge: 60_000 },
    upload: { maxBytes: 1024 * 1024, maxFiles: 5 },
  };
  const runningApp = createAdminApp({
    config,
    pool: { query: async () => ({ rows: [{ "?column?": 1 }] }) },
    repository: {},
    sessionStore: new session.MemoryStore(),
    getBotStatus: () => "running",
  });
  const running = await request(runningApp).get("/health").expect(200);
  assert.deepEqual(running.body, { status: "ok", bot: "running" });

  const downApp = createAdminApp({
    config,
    pool: {
      query: async () => {
        throw new Error("db down");
      },
    },
    repository: {},
    sessionStore: new session.MemoryStore(),
    getBotStatus: () => "stopped",
  });
  const down = await request(downApp).get("/health").expect(503);
  assert.deepEqual(down.body, { status: "error", bot: "stopped" });
});

test("formatGeneratorUser prefers Telegram username", () => {
  assert.equal(formatGeneratorUser({ username: "wise_user", display_name: "Wise", user_id: 1 }), "@wise_user");
  assert.equal(formatGeneratorUser({ display_name: "Wise User", user_id: 7 }), "Wise User");
  assert.equal(formatGeneratorUser({ user_id: 7 }), "id 7");
  assert.equal(formatGeneratorUser({ chat_id: "42" }), "chat 42");
});

test("admin authentication protects content and accepts bulk uploads", async () => {
  const { app, generatedImages, images, quotes } = await fixture();
  const agent = request.agent(app);

  await agent.get("/admin/quotes").expect(302).expect("Location", "/admin/login");
  await loginAsAdmin(agent);

  const quotesPage = await agent.get("/admin/quotes").expect(200);
  assert.match(quotesPage.text, /class="app-shell"/);
  assert.match(quotesPage.text, /class="nav-link active"/);
  assert.match(quotesPage.text, /Панель управления/);
  const quoteCsrf = extractCsrf(quotesPage.text);
  await agent
    .post("/admin/quotes")
    .field("_csrf", quoteCsrf)
    .field("quotes", '["Первая", "Вторая"]')
    .expect(302);
  assert.equal(quotes.length, 2);

  const imagesPage = await agent.get("/admin/images").expect(200);
  const imageCsrf = extractCsrf(imagesPage.text);
  const png = createCanvas(20, 20).toBuffer("image/png");
  await agent
    .post("/admin/images")
    .field("_csrf", imageCsrf)
    .attach("images", png, { filename: "background.png", contentType: "image/png" })
    .expect(302);
  assert.equal(images.length, 1);
  assert.ok(Buffer.isBuffer(images[0].data));

  const refreshedImagesPage = await agent.get("/admin/images").expect(200);
  assert.match(refreshedImagesPage.text, /data-modal-image/);
  assert.match(refreshedImagesPage.text, /id="image-modal"/);
  await agent.get("/admin/admin.js").expect("Content-Type", /javascript/).expect(200);
  const limitCsrf = extractCsrf(refreshedImagesPage.text);
  let oversizedRequest = agent.post("/admin/images").field("_csrf", limitCsrf);
  for (let index = 0; index < 6; index += 1) {
    oversizedRequest = oversizedRequest.attach("images", png, {
      filename: `background-${index}.png`,
      contentType: "image/png",
    });
  }
  await oversizedRequest.expect(302).expect("Location", "/admin/images");
  assert.equal(images.length, 1);

  const generatedPage = await agent.get("/admin/generated").expect(200);
  assert.match(generatedPage.text, /Сохранённая мудрость/);
  assert.match(generatedPage.text, /@wise_user/);
  assert.match(generatedPage.text, /Пользователь/);
  assert.match(generatedPage.text, /data-modal-image/);
  assert.match(generatedPage.text, /id="image-modal"/);
  await agent.get("/admin/generated/1/preview").expect("Content-Type", /image\/png/).expect(200);
  const generatedCsrf = extractCsrf(generatedPage.text);
  await agent
    .post("/admin/generated/1/delete")
    .type("form")
    .send({ _csrf: generatedCsrf })
    .expect(302)
    .expect("Location", "/admin/generated");
  assert.equal(generatedImages.length, 0);
});

test("admin logs page lists entries and supports clear", async () => {
  const { app, logs } = await fixture();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const logsPage = await agent.get("/admin/logs").expect(200);
  assert.match(logsPage.text, /Логи/);
  assert.match(logsPage.text, /Image generation failed/);
  assert.match(logsPage.text, /ENOMEM/);

  const filtered = await agent.get("/admin/logs?level=error").expect(200);
  assert.match(filtered.text, /Image generation failed/);

  const clearCsrf = extractCsrf(logsPage.text);
  await agent
    .post("/admin/logs/clear")
    .type("form")
    .send({ _csrf: clearCsrf })
    .expect(302)
    .expect("Location", "/admin/logs");
  assert.equal(logs.length, 0);
});

test("admin accounts can be created and protect self/last admin deletion", async () => {
  const { admins, app } = await fixture();
  const agent = request.agent(app);
  await loginAsAdmin(agent);

  const accountsPage = await agent.get("/admin/accounts").expect(200);
  assert.match(accountsPage.text, /Аккаунты/);
  assert.match(accountsPage.text, /Текущий аккаунт/);

  const shortPasswordCsrf = extractCsrf(accountsPage.text);
  await agent
    .post("/admin/accounts")
    .type("form")
    .send({ _csrf: shortPasswordCsrf, username: "operator", password: "short" })
    .expect(302)
    .expect("Location", "/admin/accounts");
  assert.equal(admins.length, 1);

  const createPage = await agent.get("/admin/accounts").expect(200);
  const createCsrf = extractCsrf(createPage.text);
  await agent
    .post("/admin/accounts")
    .type("form")
    .send({
      _csrf: createCsrf,
      username: "Operator",
      password: "very-long-second-password",
    })
    .expect(302)
    .expect("Location", "/admin/accounts");
  assert.equal(admins.length, 2);
  assert.equal(admins[1].username, "operator");

  const selfDeletePage = await agent.get("/admin/accounts").expect(200);
  const selfDeleteCsrf = extractCsrf(selfDeletePage.text);
  await agent
    .post("/admin/accounts/1/delete")
    .type("form")
    .send({ _csrf: selfDeleteCsrf })
    .expect(302)
    .expect("Location", "/admin/accounts");
  assert.equal(admins.length, 2);

  const deleteOtherPage = await agent.get("/admin/accounts").expect(200);
  const deleteOtherCsrf = extractCsrf(deleteOtherPage.text);
  await agent
    .post("/admin/accounts/2/delete")
    .type("form")
    .send({ _csrf: deleteOtherCsrf })
    .expect(302)
    .expect("Location", "/admin/accounts");
  assert.equal(admins.length, 1);

  const lastAdminPage = await agent.get("/admin/accounts").expect(200);
  const lastAdminCsrf = extractCsrf(lastAdminPage.text);
  await agent
    .post("/admin/accounts/1/delete")
    .type("form")
    .send({ _csrf: lastAdminCsrf })
    .expect(302)
    .expect("Location", "/admin/accounts");
  assert.equal(admins.length, 1);
});
