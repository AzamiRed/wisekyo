const { Telegraf, Markup } = require("telegraf");
const { createCanvas, loadImage, registerFont } = require("canvas");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const BOT_TOKEN = '8757722633:AAHdbAv0TYLSZoxozn2hmPTwgmrx1nEqOrg';
if (!BOT_TOKEN) process.exit(1);

const bot = new Telegraf(BOT_TOKEN);

const imagesFolder = path.join(__dirname, "images");
const tempFolder = path.join(__dirname, "temp");
const fontsFolder = path.join(__dirname, "fonts");
if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);
registerFont(path.join(fontsFolder, "Impact.ttf"), { family: "Impact" });

const lastMessages = new Map();
const awaitingInput = new Map(); // chatId => действие

// ===== Функции генерации =====
function getRandomWisdom() {
    const wisdomFile = path.join(__dirname, "wisdom.txt");
    if (!fs.existsSync(wisdomFile)) return "Мудрость пока не добавлена.";
    const lines = fs.readFileSync(wisdomFile, "utf8").split("\n").filter(l => l.trim());
    return lines[Math.floor(Math.random() * lines.length)] || "Мудрость пока не добавлена.";
}

function getRandomImage() {
    const files = fs.readdirSync(imagesFolder)
        .filter(f => [".png",".jpg",".jpeg"].includes(path.extname(f).toLowerCase()));
    if (!files.length) throw new Error("В папке images нет изображений!");
    return path.join(imagesFolder, files[Math.floor(Math.random() * files.length)]);
}

async function generateImage(text) {
    const image = await loadImage(getRandomImage());
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    ctx.font = "60px Impact";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "black";
    ctx.lineWidth = 5;
    ctx.textAlign = "center";

    const words = text.split(" ");
    let line = "", lines = [];
    for (let n=0;n<words.length;n++) {
        const testLine = line + words[n] + " ";
        if (ctx.measureText(testLine).width > canvas.width - 100 && n>0) {
            lines.push(line);
            line = words[n]+" ";
        } else line = testLine;
    }
    lines.push(line);
    const startY = canvas.height - 80 - (lines.length-1)*70;
    lines.forEach((line,i)=> { ctx.strokeText(line.trim(), canvas.width/2, startY+i*70); ctx.fillText(line.trim(), canvas.width/2, startY+i*70); });

    const fileName = uuidv4()+".png";
    const outputPath = path.join(tempFolder,fileName);
    fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
    return outputPath;
}

const acceptOurWisdom = async (ctx) => {
  const chatId = ctx.chat.id;

    // Берем последнее сообщение до команды
    const text = lastMessages.get(chatId);

    if (!text) {
        return ctx.reply("В чате пока нет мудрости для генерации.");
    }

    try {
        // Генерируем картинку
        const image = await generateImage(text);
        await ctx.replyWithPhoto({ source: image });
    } catch (err) {
        console.error(err);
        ctx.reply("Ошибка при генерации мудрости.");
    }
}

const shareYourWisdom = async (ctx) => {
      try { await ctx.replyWithPhoto({ source: await generateImage(getRandomWisdom()) }); }
    catch(e){ console.error(e); ctx.reply("Ошибка генерации"); }
}

const acceptMyWisdom = (ctx) => {
        awaitingInput.set(ctx.chat.id, "accept_our");
    ctx.reply("Введите текст мудрости, чтобы я сгенерировал изображение:");
}

// ===== Меню =====
bot.command("start", (ctx) => {
    ctx.reply(`Привет! Я Мудрый Кё 🤍
Этот бот помогает делиться мудростью через красивые изображения.
С его помощью вы можете:

📜 Получить случайную мудрость из базы
💌 Принять мудрость, которую написали другие в чате
✍️ Отправить свою мудрость и увидеть её на картинке

Просто выберите команду из меню или нажмите кнопку, и Мудрый Кё превратит слова в красивое изображение.`,
        Markup.keyboard([
            ["Запросить мудрость"],
            ["Дать мудрость чата"],
            ["Дать свою мудрость"]
        ]).resize()
    );
});

bot.hears("Запросить мудрость", async (ctx) => await shareYourWisdom(ctx));
bot.command("shareyourwisdom", async (ctx) => await shareYourWisdom(ctx));

bot.hears("Дать мудрость чата", async (ctx) => await acceptOurWisdom(ctx));
bot.command("acceptourwisdom", async (ctx) => await acceptOurWisdom(ctx));

bot.hears("Дать свою мудрость", (ctx) => acceptMyWisdom(ctx));
bot.command("acceptmywisdom", async (ctx) => await acceptMyWisdom(ctx));

bot.on("message", async (ctx) => {
    const chatId = ctx.chat.id;

    if (awaitingInput.has(chatId)) {
        const action = awaitingInput.get(chatId);
        awaitingInput.delete(chatId);

        if (action === "accept_our") {
            try {
                await ctx.replyWithPhoto({ source: await generateImage(ctx.message.text) });
            } catch(e){ console.error(e); ctx.reply("Ошибка генерации"); }
            return;
        }
    }
    if (!ctx.message.text.startsWith("/")) lastMessages.set(chatId, ctx.message.text);
});

bot.launch();
console.log("wiseKyo is running");