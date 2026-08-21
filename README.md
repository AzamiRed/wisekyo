# wiseKyo

Telegram-бот генерирует изображения с цитатами. Цитаты, фоновые изображения и каждый новый результат генерации хранятся в PostgreSQL. Контент загружается через защищённую веб-админку.

## Требования

- Node.js 20+
- PostgreSQL
- системные зависимости `node-canvas` либо Docker

## Первый запуск

1. Скопируйте `.env.example` в `.env` и заполните значения.
2. Установите зависимости и подготовьте БД:

```bash
npm install
npm run migrate
npm run seed
npm start
```

`npm run seed` импортирует строки из `wisdom.txt`. Если заданы `ADMIN_USERNAME` и `ADMIN_PASSWORD`, команда также создаёт или обновляет администратора. Пароль должен содержать не менее 12 символов.

Админка доступна по адресу `http://localhost:3000/admin`, проверка состояния — `GET /health`.

Для локального HTTP оставьте `COOKIE_SECURE=false`. В production за HTTPS reverse proxy установите `COOKIE_SECURE=true` и задайте `TRUST_PROXY` точным числом доверенных proxy-переходов или CIDR; не включайте доверие к proxy при прямом доступе к Node.js.

Доступ по IP без домена (`http://IP:3000/admin`) работает только при `COOKIE_SECURE=false`. Открывайте именно `http://`, не `https://`. Если Chrome сам переводит на HTTPS, отключите «Всегда использовать защищённые соединения» или откройте админку в Firefox/Edge.

Если вход сразу возвращает на форму: в `.env` на сервере проверьте `COOKIE_SECURE=false`, затем заново выполните `docker compose run --rm app npm run seed` (пароль берётся из `ADMIN_PASSWORD`, не короче 12 символов) и пересоберите приложение.

## Загрузка контента

На странице «Цитаты» можно вставить или загрузить JSON-массив:

```json
[
  "Первая цитата",
  "Вторая цитата"
]
```

Пустые значения, нестроковые элементы, слишком длинные строки и дубликаты пропускаются. На странице «Изображения» поддерживается множественная загрузка PNG и JPEG.

Раздел «Сгенерированные» показывает сохранённые результаты работы бота, исходный текст, сценарий, Telegram-пользователя (`@username` или имя + id) и время создания. Нажатие на превью фона или результата открывает полноразмерное изображение в модальном окне. Результаты можно удалять.

Раздел «Логи» (`/admin/logs`) показывает ошибки и предупреждения бота, генератора и админки. Записи пишутся в PostgreSQL (`app_logs`), хранятся примерно последние 1000 строк; фильтр по уровню и кнопка очистки доступны в панели.

Раздел «Аккаунты» позволяет добавлять и удалять администраторов панели. Пароли хранятся как bcrypt-хеши; нельзя удалить текущий аккаунт или последнего администратора.

## Команды

- `npm start` — запустить веб-админку и Telegram-бота;
- `npm run migrate` — создать/обновить таблицы (включая `004_logs_and_generator_user.sql`: `app_logs` и поля автора у `generated_images`);
- `npm run seed` — импортировать `wisdom.txt` и создать администратора;
- `npm test` — запустить тесты.

Чтобы запустить только админку, задайте `BOT_ENABLED=false`.

`GET /health` возвращает `{ "status": "ok", "bot": "running" }` (`running`, `stopped` или `disabled`). Один `BOT_TOKEN` можно использовать только в одном запущенном процессе: иначе Telegram отвечает `409 Conflict`, и бот молчит.

## Docker Compose

Локально или на VPS:

```bash
cp .env.production.example .env
# заполните BOT_TOKEN, SESSION_SECRET, ADMIN_PASSWORD и одинаковый пароль в POSTGRES_PASSWORD и DATABASE_URL
docker compose up -d --build
docker compose run --rm app npm run migrate
docker compose run --rm app npm run seed
docker compose logs -f app
```

Админка: `http://localhost:3000/admin`  
Проверка: `GET /health` — в ответе должно быть `"bot": "running"`.

Секреты не должны попадать в git. `.env` уже в `.gitignore`.

## Деплой на Beget VPS

1. Закажите/откройте Ubuntu VPS в Beget и подключитесь по SSH.
2. Установите Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

3. Залейте проект на сервер (с Windows PowerShell):

```powershell
scp -r C:\Projects\wiseKyo root@IP_СЕРВЕРА:/opt/wisekyo
```

4. На сервере:

```bash
cd /opt/wisekyo
cp .env.production.example .env
nano .env
```

Заполните `BOT_TOKEN`, `SESSION_SECRET`, `ADMIN_PASSWORD`.  
Пароль в `POSTGRES_PASSWORD` и в `DATABASE_URL` должен совпадать. Хост в `DATABASE_URL` — `postgres`.

5. Запуск:

```bash
docker compose up -d --build
docker compose run --rm app npm run migrate
docker compose run --rm app npm run seed
docker compose logs -f app
```

6. Проверьте:

- `http://IP_СЕРВЕРА:3000/health` — `"bot": "running"`
- `http://IP_СЕРВЕРА:3000/admin`
- в Telegram: `/start`

Пока нет HTTPS-домена оставляйте `COOKIE_SECURE=false` и заходите только по `http://IP:3000/admin` (не `https://`). После reverse proxy (Caddy/Nginx) поставьте `COOKIE_SECURE=true` и `TRUST_PROXY=1`, затем `docker compose up -d`.
