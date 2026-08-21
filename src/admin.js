const { randomBytes, timingSafeEqual } = require("crypto");
const express = require("express");
const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
const { loadImage } = require("canvas");
const { detectImageType, getImageDimensions, parseQuoteArray } = require("./content");

function limitedMemoryStorage(maxTotalBytes) {
  return {
    _handleFile(req, file, callback) {
      const chunks = [];
      let size = 0;
      let uploadError = null;
      let finished = false;
      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        callback(error, value);
      };

      file.stream.on("limit", () => {
        uploadError = new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname);
        chunks.length = 0;
      });
      file.stream.on("data", (chunk) => {
        size += chunk.length;
        req.totalUploadBytes = (req.totalUploadBytes || 0) + chunk.length;
        if (req.totalUploadBytes > maxTotalBytes) {
          uploadError = new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname);
          chunks.length = 0;
        } else if (!uploadError) {
          chunks.push(chunk);
        }
      });
      file.stream.on("error", (error) => finish(error));
      file.stream.on("end", () => {
        if (uploadError) return finish(uploadError);
        finish(null, { buffer: Buffer.concat(chunks), size });
      });
    },
    _removeFile(_req, file, callback) {
      delete file.buffer;
      callback(null);
    },
  };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortenFilename(value = "", maxLength = 36) {
  const name = String(value).trim();
  if (name.length <= maxLength) return name;
  const extensionMatch = name.match(/(\.[a-z0-9]{1,8})$/i);
  const extension = extensionMatch ? extensionMatch[1] : "";
  const base = extension ? name.slice(0, -extension.length) : name;
  const available = Math.max(8, maxLength - extension.length - 1);
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${base.slice(0, head)}…${base.slice(-tail)}${extension}`;
}

function csrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString("hex");
  return req.session.csrfToken;
}

function csrfField(req) {
  return `<input type="hidden" name="_csrf" value="${csrfToken(req)}">`;
}

function verifyCsrf(req, res, next) {
  const expected = req.session.csrfToken || "";
  const supplied = typeof req.body?._csrf === "string" ? req.body._csrf : "";
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  const valid =
    expectedBuffer.length === suppliedBuffer.length &&
    expectedBuffer.length > 0 &&
    timingSafeEqual(expectedBuffer, suppliedBuffer);
  if (!valid) {
    if (req.path === "/admin/login") {
      setFlash(req, "error", "Сессия входа устарела. Обновите страницу и войдите снова.");
      return res.redirect("/admin/login");
    }
    return res.status(403).send("Недействительный CSRF-токен. Обновите страницу.");
  }
  next();
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function takeFlash(req) {
  const flash = req.session.flash;
  delete req.session.flash;
  return flash;
}

function renderPage({ title, body, req, authenticated = true }) {
  const flash = takeFlash(req);
  const navItem = (href, label) => {
    const active = req.path.startsWith(href) ? " active" : "";
    return `<a class="nav-link${active}" href="${href}">${label}</a>`;
  };
  const navigation = authenticated
    ? `<aside class="sidebar">
       <a class="brand" href="/admin"><span class="brand-mark">➤</span>
       <span><strong>wiseKyo</strong><small>Панель управления</small></span></a>
       <nav class="side-nav" aria-label="Разделы админки">
       ${navItem("/admin/quotes", "Цитаты")}
       ${navItem("/admin/images", "Фоновые изображения")}
       ${navItem("/admin/generated", "Сгенерированные")}
       ${navItem("/admin/logs", "Логи")}
       ${navItem("/admin/accounts", "Аккаунты")}
       </nav>
       <form class="logout-form" method="post" action="/admin/logout">${csrfField(req)}
       <button class="logout-button">Выйти из аккаунта</button></form>
       </aside>`
    : "";
  const notice = flash
    ? `<div class="notice ${escapeHtml(flash.type)}">${escapeHtml(flash.message)}</div>`
    : "";
  const modal = authenticated
    ? `<dialog id="image-modal" aria-labelledby="image-modal-title">
       <div class="modal-header"><strong id="image-modal-title">Просмотр изображения</strong>
       <button type="button" class="secondary" data-modal-close>Закрыть</button></div>
       <img id="image-modal-content" alt=""></dialog>`
    : "";
  const modalScript = authenticated ? '<script src="/admin/admin.js" defer></script>' : "";
  const page = authenticated
    ? `<div class="app-shell">${navigation}<main class="main-content">
       <header class="topbar"><div><span class="eyebrow">Управление контентом</span>
       <strong>${escapeHtml(title)}</strong></div><span class="database-status"><i></i> PostgreSQL</span></header>
       ${notice}${body}</main></div>`
    : `<main class="auth-shell">${notice}${body}</main>`;

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} — wiseKyo</title>
<style>
:root{font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#17212b;background:#eef4f8;line-height:1.45}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% 5%,#d9f2ff 0,transparent 30%),#eef4f8}
a{color:inherit;text-decoration:none}.app-shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.sidebar{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:28px 20px;background:linear-gradient(180deg,#17212b,#202f3c);color:#fff;box-shadow:8px 0 28px #17212b14}
.brand{display:flex;align-items:center;gap:13px;padding:4px 8px 28px}.brand-mark{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;background:linear-gradient(145deg,#35b4ee,#168acd);font-size:22px;box-shadow:0 8px 20px #0e8cc766}
.brand strong{display:block;font-size:19px;letter-spacing:.2px}.brand small{display:block;margin-top:1px;color:#91a7b8;font-size:12px}
.side-nav{display:flex;flex-direction:column;gap:7px}.nav-link{padding:12px 14px;border-radius:10px;color:#b8c9d6;font-weight:600;font-size:14px;transition:.18s ease}
.nav-link:hover{color:#fff;background:#ffffff12;transform:translateX(2px)}.nav-link.active{color:#fff;background:linear-gradient(135deg,#2aabee,#229ed9);box-shadow:0 8px 22px #168acd3d}
.logout-form{margin-top:auto}.logout-button{width:100%;background:#ffffff0d!important;color:#b8c9d6!important;box-shadow:none!important}.logout-button:hover{color:#fff!important;background:#ffffff17!important}
.main-content{min-width:0;padding:28px clamp(20px,4vw,54px) 54px}.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:18px;border-bottom:1px solid #d9e3ea}
.topbar>div{display:flex;flex-direction:column}.topbar strong{font-size:18px}.eyebrow{color:#7b8d9b;font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}
.database-status{display:flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid #d5e5ed;border-radius:999px;background:#fff;color:#597080;font-size:12px;font-weight:700}
.database-status i{width:8px;height:8px;border-radius:50%;background:#31c48d;box-shadow:0 0 0 4px #31c48d1f}
h1{margin:0 0 22px;font-size:clamp(25px,3vw,34px);letter-spacing:-.035em}h2{margin:0 0 8px;font-size:18px}
.card{overflow-x:auto;margin-bottom:22px;padding:24px;background:#fff;border:1px solid #dce8ef;border-radius:16px;box-shadow:0 8px 30px #273b4a0a}
.card:hover{border-color:#c9dfe9}label{display:block;margin:16px 0 7px;color:#334b5c;font-size:13px;font-weight:750}
input,textarea{width:100%;padding:12px 14px;border:1px solid #cbdce5;border-radius:10px;background:#f9fcfd;color:#17212b;font:inherit;outline:none;transition:.18s ease}
input:focus,textarea:focus{border-color:#2aabee;background:#fff;box-shadow:0 0 0 4px #2aabee1a}input[type=file]{padding:10px}
textarea{min-height:180px;resize:vertical;font-family:"Cascadia Code",ui-monospace,monospace;font-size:13px}
button{cursor:pointer;border:0;border-radius:9px;padding:10px 15px;background:linear-gradient(135deg,#2aabee,#229ed9);color:#fff;font:inherit;font-size:13px;font-weight:750;box-shadow:0 6px 14px #229ed92b;transition:.18s ease}
button:hover{transform:translateY(-1px);filter:saturate(1.08)}button:active{transform:translateY(0)}button.danger{background:#fff0f0;color:#d33b3b;box-shadow:none}
button.danger:hover{background:#ffe3e3}button.secondary{background:#e9f2f7;color:#405b6c;box-shadow:none}.row{display:flex;gap:8px;align-items:center}
table{width:100%;border-collapse:separate;border-spacing:0;background:#fff;font-size:14px}th{text-transform:uppercase;letter-spacing:.055em;color:#7b8d9b;font-size:10px;font-weight:800}
th,td{text-align:left;border-bottom:1px solid #edf2f5;padding:13px 12px;vertical-align:middle}tbody tr{transition:background .15s}tbody tr:hover{background:#f6fbfe}tbody tr:last-child td{border-bottom:0}
.filename{display:inline-block;max-width:min(42vw,320px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;font-family:"Cascadia Code",ui-monospace,monospace;font-size:12px;color:#405b6c}
.log-level{display:inline-block;padding:3px 8px;border-radius:999px;background:#e9f2f7;font-size:11px;font-weight:800;text-transform:uppercase}
.log-error .log-level{background:#ffe3e3;color:#b42318}.log-warn .log-level{background:#fff4df;color:#9a6700}.log-info .log-level{background:#e8f7ee;color:#0f7b3c}
pre.log-details{white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;margin:8px 0 0;padding:10px;border-radius:8px;background:#f4f8fb;font-size:12px}
.notice{margin-bottom:18px;padding:13px 16px;border:1px solid #bee3f8;border-radius:11px;background:#eaf7ff;color:#146b97;font-size:14px;font-weight:650}
.notice.error{border-color:#ffc9c9;background:#fff0f0;color:#b42318}.muted{color:#718491;font-size:13px}
img.thumb{width:130px;height:86px;object-fit:cover;border-radius:9px;background:#e9f0f4;box-shadow:0 3px 12px #17212b18}.image-preview{padding:0;background:transparent;box-shadow:none}
.image-preview:hover{transform:scale(1.025);filter:none}dialog{width:min(92vw,1100px);max-height:92vh;border:1px solid #d8e7ee;border-radius:18px;padding:18px;background:#f8fbfd;box-shadow:0 24px 80px #10212ddd}
dialog::backdrop{background:#10212bcc;backdrop-filter:blur(5px)}.modal-header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:14px}
#image-modal-content{display:block;max-width:100%;max-height:78vh;margin:auto;border-radius:10px;object-fit:contain}.auth-shell{display:grid;place-items:center;min-height:100vh;padding:24px}
.auth-shell .card{width:min(100%,440px);margin:0!important;padding:32px!important;box-shadow:0 20px 60px #17212b1c!important}
@media(max-width:800px){.app-shell{display:block}.sidebar{position:relative;height:auto;padding:16px}.brand{padding:2px 4px 14px}.side-nav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.nav-link{text-align:center;padding:10px 7px;font-size:12px}.logout-form{margin-top:12px}.main-content{padding:22px 14px 40px}.topbar{margin-bottom:22px}.database-status{display:none}.card{padding:17px;border-radius:13px}table{min-width:620px}.hide-mobile{display:none}}
@media(max-width:480px){.side-nav{grid-template-columns:1fr}.brand-mark{width:38px;height:38px}.topbar strong{font-size:16px}}
</style></head><body>${page}${modal}${modalScript}</body></html>`;
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.redirect("/admin/login");
  next();
}

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function generatedSourceLabel(source) {
  return {
    random: "Случайная цитата",
    chat: "Мудрость чата",
    own: "Свой текст",
  }[source] || source;
}

function formatGeneratorUser(image) {
  if (image.username) return `@${image.username}`;
  if (image.display_name) return image.display_name;
  if (image.user_id) return `id ${image.user_id}`;
  if (image.chat_id) return `chat ${image.chat_id}`;
  return "—";
}

function createAdminApp({ config, pool, repository, sessionStore, logger, getBotStatus }) {
  const app = express();
  const PgStore = connectPgSimple(session);
  const quoteUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  });
  const imageUpload = multer({
    storage: limitedMemoryStorage(config.upload.maxTotalBytes || 25 * 1024 * 1024),
    limits: { fileSize: config.upload.maxBytes, files: config.upload.maxFiles },
  });

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      // Allow plain HTTP access by IP until a reverse proxy terminates TLS.
      strictTransportSecurity: config.cookie.secure ? undefined : false,
      contentSecurityPolicy: {
        directives: {
          imgSrc: ["'self'", "data:"],
          ...(config.cookie.secure ? {} : { upgradeInsecureRequests: null }),
        },
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
  app.use(
    session({
      store: sessionStore || new PgStore({ pool, tableName: "session" }),
      name: "wisekyo.sid",
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: Boolean(config.trustProxy),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        // Never mark cookies Secure on plain HTTP IP access.
        secure: config.cookie.secure === true,
        maxAge: config.cookie.maxAge,
        path: "/",
      },
    })
  );

  app.get("/health", async (_req, res) => {
    const bot = typeof getBotStatus === "function" ? getBotStatus() : "unknown";
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok", bot });
    } catch {
      res.status(503).json({ status: "error", bot });
    }
  });
  app.get("/", (_req, res) => res.redirect("/admin"));
  app.get("/admin", requireAdmin, (_req, res) => res.redirect("/admin/quotes"));
  app.get("/admin/admin.js", requireAdmin, (_req, res) => {
    res
      .type("application/javascript")
      .set("Cache-Control", "private, max-age=3600")
      .send(`(() => {
  const modal = document.getElementById("image-modal");
  const image = document.getElementById("image-modal-content");
  if (!modal || !image) return;
  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-modal-image]");
    if (trigger) {
      image.src = trigger.dataset.fullSrc;
      image.alt = trigger.dataset.alt || "";
      modal.showModal();
      return;
    }
    if (event.target.closest("[data-modal-close]") || event.target === modal) {
      modal.close();
      image.removeAttribute("src");
    }
  });
})();`);
  });

  app.get("/admin/login", (req, res, next) => {
    if (req.session.adminId) return res.redirect("/admin/quotes");
    csrfToken(req);
    const body = `<main class="card" style="max-width:420px;margin:10vh auto"><h1>Вход в админку</h1>
      <form method="post" action="/admin/login" accept-charset="UTF-8">${csrfField(req)}
      <label for="username">Логин</label><input id="username" name="username" autocomplete="username" required>
      <label for="password">Пароль</label><input id="password" type="password" name="password" autocomplete="current-password" required>
      <p><button type="submit">Войти</button></p></form></main>`;
    req.session.save((error) => {
      if (error) return next(error);
      res.send(renderPage({ title: "Вход", body, req, authenticated: false }));
    });
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "Слишком много попыток. Повторите позже.",
  });
  app.post("/admin/login", loginLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const admin = await repository.findAdmin(req.body.username || "");
      const valid = admin && (await bcrypt.compare(req.body.password || "", admin.password_hash));
      if (!valid) {
        setFlash(req, "error", "Неверный логин или пароль.");
        return res.redirect("/admin/login");
      }
      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.adminId = admin.id;
        req.session.csrfToken = randomBytes(32).toString("hex");
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          res.redirect("/admin/quotes");
        });
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/logout", requireAdmin, verifyCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie("wisekyo.sid");
      res.redirect("/admin/login");
    });
  });

  app.get("/admin/quotes", requireAdmin, async (req, res, next) => {
    try {
      const quotes = await repository.listQuotes();
      const rows = quotes
        .map(
          (quote) => `<tr><td>${escapeHtml(quote.text)}</td><td>${quote.active ? "Активна" : "Отключена"}</td>
          <td class="row"><form method="post" action="/admin/quotes/${quote.id}/toggle">${csrfField(req)}
          <button class="secondary">${quote.active ? "Отключить" : "Включить"}</button></form>
          <form method="post" action="/admin/quotes/${quote.id}/delete">${csrfField(req)}
          <button class="danger">Удалить</button></form></td></tr>`
        )
        .join("");
      const body = `<h1>Цитаты</h1><section class="card"><h2>Массовая загрузка</h2>
        <p class="muted">Вставьте JSON-массив строк или загрузите файл .json.</p>
        <form method="post" action="/admin/quotes" enctype="multipart/form-data">${csrfField(req)}
        <label for="quotes">JSON-массив</label><textarea id="quotes" name="quotes" placeholder='[\"Первая цитата\", \"Вторая цитата\"]'></textarea>
        <label for="quotesFile">Или JSON-файл</label><input id="quotesFile" type="file" name="quotesFile" accept=".json,application/json">
        <p><button>Загрузить цитаты</button></p></form></section>
        <section class="card"><h2>Последние цитаты (${quotes.length})</h2>
        <table><thead><tr><th>Текст</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows}</tbody></table></section>`;
      res.send(renderPage({ title: "Цитаты", body, req }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/quotes", requireAdmin, quoteUpload.single("quotesFile"), verifyCsrf, async (req, res) => {
    try {
      const input = req.file?.buffer.toString("utf8") || req.body.quotes;
      const { quotes, skipped } = parseQuoteArray(input);
      const inserted = await repository.insertQuotes(quotes);
      const duplicates = quotes.length - inserted.length;
      setFlash(req, "success", `Добавлено: ${inserted.length}. Дубликаты: ${duplicates}. Пропущено: ${skipped}.`);
    } catch (error) {
      setFlash(req, "error", error.message);
    }
    res.redirect("/admin/quotes");
  });

  app.post("/admin/quotes/:id/toggle", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.sendStatus(400);
      const quotes = await repository.listQuotes();
      const quote = quotes.find((item) => Number(item.id) === id);
      if (!quote) return res.sendStatus(404);
      await repository.setQuoteActive(id, !quote.active);
      res.redirect("/admin/quotes");
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/quotes/:id/delete", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.sendStatus(400);
      await repository.deleteQuote(id);
      res.redirect("/admin/quotes");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/images", requireAdmin, async (req, res, next) => {
    try {
      const images = await repository.listImages();
      const rows = images
        .map((image) => {
          const fullName = image.original_name || `image-${image.id}`;
          const shortName = shortenFilename(fullName);
          return `<tr><td><button type="button" class="image-preview" data-modal-image
          data-full-src="/admin/images/${image.id}/preview" data-alt="${escapeHtml(fullName)}">
          <img class="thumb" src="/admin/images/${image.id}/preview" alt="${escapeHtml(fullName)}"></button></td>
          <td><span class="filename" title="${escapeHtml(fullName)}">${escapeHtml(shortName)}</span></td>
          <td>${image.active ? "Активно" : "Отключено"}</td>
          <td class="row"><form method="post" action="/admin/images/${image.id}/toggle">${csrfField(req)}
          <button class="secondary">${image.active ? "Отключить" : "Включить"}</button></form>
          <form method="post" action="/admin/images/${image.id}/delete">${csrfField(req)}
          <button class="danger">Удалить</button></form></td></tr>`;
        })
        .join("");
      const body = `<h1>Изображения</h1><section class="card"><h2>Загрузка</h2>
        <p class="muted">PNG или JPEG, до ${Math.round(config.upload.maxBytes / 1024 / 1024)} МБ на файл,
        не более ${config.upload.maxFiles} файлов за одну загрузку.</p>
        <form method="post" action="/admin/images" enctype="multipart/form-data">${csrfField(req)}
        <input type="file" name="images" accept="image/png,image/jpeg" multiple required>
        <p><button>Загрузить изображения</button></p></form></section>
        <section class="card"><h2>Последние изображения (${images.length})</h2>
        <table><thead><tr><th>Превью</th><th>Имя</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows}</tbody></table></section>`;
      res.send(renderPage({ title: "Изображения", body, req }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/images", requireAdmin, imageUpload.array("images", config.upload.maxFiles), verifyCsrf, async (req, res) => {
    let added = 0;
    let skipped = 0;
    for (const file of req.files || []) {
      const type = detectImageType(file.buffer);
      if (!type) {
        skipped += 1;
        continue;
      }
      try {
        const dimensions = getImageDimensions(file.buffer, type.mimeType);
        if (
          !dimensions ||
          dimensions.width < 1 ||
          dimensions.height < 1 ||
          dimensions.width * dimensions.height > (config.upload.maxPixels || 40_000_000)
        ) {
          skipped += 1;
          continue;
        }
        const decoded = await loadImage(file.buffer);
        if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) {
          skipped += 1;
          continue;
        }
      } catch (error) {
        if (logger?.error) await logger.error("admin", "Image decode failed during upload", error);
        skipped += 1;
        continue;
      }
      try {
        await repository.insertImage({
          originalName: file.originalname,
          mimeType: type.mimeType,
          data: file.buffer,
        });
        added += 1;
      } catch (error) {
        console.error("Image insert failed:", error);
        if (logger?.error) await logger.error("admin", "Image insert failed", error);
        skipped += 1;
      }
    }
    setFlash(req, skipped ? "error" : "success", `Загружено: ${added}. Пропущено: ${skipped}.`);
    res.redirect("/admin/images");
  });

  app.get("/admin/images/:id/preview", requireAdmin, async (req, res, next) => {
    try {
      const image = await repository.getImage(parseId(req.params.id));
      if (!image) return res.sendStatus(404);
      res.set("Content-Type", image.mime_type).set("Cache-Control", "private, max-age=300").send(image.data);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/images/:id/toggle", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      const image = await repository.getImage(parseId(req.params.id));
      if (!image) return res.sendStatus(404);
      await repository.setImageActive(image.id, !image.active);
      res.redirect("/admin/images");
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/images/:id/delete", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      const image = await repository.getImage(parseId(req.params.id));
      if (!image) return res.sendStatus(404);
      await repository.deleteImage(image.id);
      res.redirect("/admin/images");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/generated", requireAdmin, async (req, res, next) => {
    try {
      const generatedImages = await repository.listGeneratedImages();
      const rows = generatedImages
        .map((image) => {
          const createdAt = new Date(image.created_at).toLocaleString("ru-RU");
          const userLabel = formatGeneratorUser(image);
          const userMeta = [
            image.display_name && image.username ? escapeHtml(image.display_name) : "",
            image.user_id ? `id ${escapeHtml(image.user_id)}` : "",
            image.chat_id ? `chat ${escapeHtml(image.chat_id)}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          return `<tr><td><button type="button" class="image-preview" data-modal-image
          data-full-src="/admin/generated/${image.id}/preview" data-alt="${escapeHtml(image.text)}">
          <img class="thumb" src="/admin/generated/${image.id}/preview" alt="${escapeHtml(image.text)}"></button></td>
          <td>${escapeHtml(image.text)}</td>
          <td>${escapeHtml(generatedSourceLabel(image.source))}</td>
          <td><strong>${escapeHtml(userLabel)}</strong>${
            userMeta ? `<div class="muted">${userMeta}</div>` : ""
          }</td>
          <td class="hide-mobile">${escapeHtml(createdAt)}</td>
          <td><form method="post" action="/admin/generated/${image.id}/delete">${csrfField(req)}
          <button class="danger">Удалить</button></form></td></tr>`;
        })
        .join("");
      const body = `<h1>Сгенерированные изображения</h1>
        <section class="card"><p class="muted">Последние результаты генерации: ${generatedImages.length}.</p>
        <table><thead><tr><th>Превью</th><th>Текст</th><th>Источник</th><th>Пользователь</th>
        <th class="hide-mobile">Создано</th><th>Действия</th></tr></thead>
        <tbody>${rows}</tbody></table></section>`;
      res.send(renderPage({ title: "Сгенерированные изображения", body, req }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/generated/:id/preview", requireAdmin, async (req, res, next) => {
    try {
      const image = await repository.getGeneratedImage(parseId(req.params.id));
      if (!image) return res.sendStatus(404);
      res.set("Content-Type", "image/png").set("Cache-Control", "private, max-age=300").send(image.data);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/generated/:id/delete", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.sendStatus(400);
      const deleted = await repository.deleteGeneratedImage(id);
      if (!deleted) return res.sendStatus(404);
      res.redirect("/admin/generated");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/logs", requireAdmin, async (req, res, next) => {
    try {
      const level = ["info", "warn", "error"].includes(req.query.level) ? req.query.level : null;
      const logs = await repository.listLogs({ limit: 300, level });
      const rows = logs
        .map((entry) => {
          const createdAt = new Date(entry.created_at).toLocaleString("ru-RU");
          const details = entry.details
            ? `<details><summary>Подробности</summary><pre class="log-details">${escapeHtml(
                entry.details
              )}</pre></details>`
            : "";
          return `<tr class="log-${escapeHtml(entry.level)}">
            <td class="hide-mobile">${escapeHtml(createdAt)}</td>
            <td><span class="log-level">${escapeHtml(entry.level)}</span></td>
            <td>${escapeHtml(entry.source)}</td>
            <td>${escapeHtml(entry.message)}${details}</td>
          </tr>`;
        })
        .join("");
      const filterLink = (value, label) => {
        const active = (value || "") === (level || "") ? " active" : "";
        const href = value ? `/admin/logs?level=${value}` : "/admin/logs";
        return `<a class="nav-link${active}" href="${href}" style="display:inline-block">${label}</a>`;
      };
      const body = `<h1>Логи</h1>
        <section class="card">
          <div class="row" style="flex-wrap:wrap;margin-bottom:16px">
            ${filterLink(null, "Все")}
            ${filterLink("error", "Ошибки")}
            ${filterLink("warn", "Предупреждения")}
            ${filterLink("info", "Инфо")}
            <form method="post" action="/admin/logs/clear" style="margin-left:auto">${csrfField(req)}
            <button class="danger">Очистить логи</button></form>
          </div>
          <p class="muted">Хранятся последние записи приложения и бота (${logs.length}).</p>
          <table><thead><tr><th class="hide-mobile">Время</th><th>Уровень</th><th>Источник</th><th>Сообщение</th></tr></thead>
          <tbody>${rows || "<tr><td colspan='4' class='muted'>Логов пока нет.</td></tr>"}</tbody></table>
        </section>`;
      res.send(renderPage({ title: "Логи", body, req }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/logs/clear", requireAdmin, verifyCsrf, async (req, res, next) => {
    try {
      await repository.clearLogs();
      setFlash(req, "success", "Логи очищены.");
      res.redirect("/admin/logs");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/accounts", requireAdmin, async (req, res, next) => {
    try {
      const admins = await repository.listAdmins();
      const rows = admins
        .map((account) => {
          const createdAt = new Date(account.created_at).toLocaleString("ru-RU");
          const isSelf = Number(account.id) === Number(req.session.adminId);
          const deleteControl = isSelf
            ? `<span class="muted">Текущий аккаунт</span>`
            : `<form method="post" action="/admin/accounts/${account.id}/delete">${csrfField(req)}
               <button class="danger">Удалить</button></form>`;
          return `<tr><td>${escapeHtml(account.username)}</td>
          <td class="hide-mobile">${escapeHtml(createdAt)}</td>
          <td>${deleteControl}</td></tr>`;
        })
        .join("");
      const body = `<h1>Аккаунты</h1>
        <section class="card"><h2>Добавить администратора</h2>
        <p class="muted">Пароль не менее 12 символов. Логин сохраняется в нижнем регистре.</p>
        <form method="post" action="/admin/accounts">${csrfField(req)}
        <label for="username">Логин</label>
        <input id="username" name="username" autocomplete="off" required maxlength="64">
        <label for="password">Пароль</label>
        <input id="password" type="password" name="password" autocomplete="new-password" required minlength="12">
        <p><button>Создать аккаунт</button></p></form></section>
        <section class="card"><h2>Администраторы (${admins.length})</h2>
        <table><thead><tr><th>Логин</th><th class="hide-mobile">Создан</th><th>Действия</th></tr></thead>
        <tbody>${rows}</tbody></table></section>`;
      res.send(renderPage({ title: "Аккаунты", body, req }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/accounts", requireAdmin, verifyCsrf, async (req, res) => {
    try {
      const username = String(req.body.username || "")
        .trim()
        .toLowerCase();
      const password = String(req.body.password || "");
      if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
        setFlash(req, "error", "Логин: 3–64 символа, только латиница, цифры, точка, _ и -.");
        return res.redirect("/admin/accounts");
      }
      if (password.length < 12) {
        setFlash(req, "error", "Пароль должен содержать не менее 12 символов.");
        return res.redirect("/admin/accounts");
      }
      if (await repository.findAdmin(username)) {
        setFlash(req, "error", "Администратор с таким логином уже существует.");
        return res.redirect("/admin/accounts");
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await repository.createAdmin({ username, passwordHash });
      setFlash(req, "success", `Аккаунт ${username} создан.`);
    } catch (error) {
      console.error("Admin create failed:", error);
      setFlash(req, "error", "Не удалось создать аккаунт.");
    }
    res.redirect("/admin/accounts");
  });

  app.post("/admin/accounts/:id/delete", requireAdmin, verifyCsrf, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) {
        setFlash(req, "error", "Некорректный идентификатор аккаунта.");
        return res.redirect("/admin/accounts");
      }
      if (Number(id) === Number(req.session.adminId)) {
        setFlash(req, "error", "Нельзя удалить текущий аккаунт.");
        return res.redirect("/admin/accounts");
      }
      const total = await repository.countAdmins();
      if (total <= 1) {
        setFlash(req, "error", "Нельзя удалить последнего администратора.");
        return res.redirect("/admin/accounts");
      }
      const deleted = await repository.deleteAdmin(id);
      if (!deleted) {
        setFlash(req, "error", "Аккаунт не найден.");
        return res.redirect("/admin/accounts");
      }
      setFlash(req, "success", "Аккаунт удалён.");
    } catch (error) {
      console.error("Admin delete failed:", error);
      setFlash(req, "error", "Не удалось удалить аккаунт.");
    }
    res.redirect("/admin/accounts");
  });

  app.use((error, req, res, _next) => {
    if (logger?.error) {
      logger.error("admin", `HTTP error on ${req.method} ${req.path}`, error);
    }
    if (error instanceof multer.MulterError) {
      setFlash(req, "error", "Файл слишком большой или превышено допустимое количество файлов.");
      const target = req.path.includes("quotes") ? "/admin/quotes" : "/admin/images";
      return res.redirect(target);
    }
    console.error(error);
    res.status(500).send("Внутренняя ошибка сервера.");
  });

  return app;
}

module.exports = { createAdminApp, escapeHtml, shortenFilename, formatGeneratorUser };
