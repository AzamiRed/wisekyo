import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Получаем __dirname в ES-модуле
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Пути
const imagesFolder = path.join(__dirname, "images");
const tempFolder = path.join(__dirname, "temp");
const fontsFolder = path.join(__dirname, "fonts");

// Получаем случайную мудрость
const getRandomWisdom = () => {
  if (!fs.existsSync(wisdomFile)) return "Мудрость пока не добавлена.";
  const lines = fs.readFileSync(wisdomFile, "utf8")
    .split("\n")
    .filter(line => line.trim() !== "");
  return lines[Math.floor(Math.random() * lines.length)] || "Мудрость пока не добавлена.";
}

// Получаем случайное изображение
const getRandomImage = () => {
  const files = fs.readdirSync(imagesFolder)
    .filter(file => [".png", ".jpg", ".jpeg"].includes(path.extname(file).toLowerCase()));
  if (files.length === 0) throw new Error("В папке images нет изображений!");
  return path.join(imagesFolder, files[Math.floor(Math.random() * files.length)]);
}

// Генерация картинки с текстом
const generateImage = async (text) =>  {
  const imagePath = getRandomImage();
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");

  // Рисуем исходное изображение
  ctx.drawImage(image, 0, 0);

  // Текст
  ctx.font = "60px Impact";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 5;
  ctx.textAlign = "center";

  // Перенос текста на несколько строк
  const words = text.split(" ");
  let line = "", lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    if (ctx.measureText(testLine).width > canvas.width - 100 && n > 0) {
      lines.push(line);
      line = words[n] + " ";
    } else line = testLine;
  }
  lines.push(line);

  const startY = canvas.height - 80 - (lines.length - 1) * 70;
  lines.forEach((line, i) => {
    ctx.strokeText(line.trim(), canvas.width / 2, startY + i * 70);
    ctx.fillText(line.trim(), canvas.width / 2, startY + i * 70);
  });

  // Создаем временную папку, если нет
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder);

  const fileName = uuidv4() + ".png";
  const outputPath = path.join(tempFolder, fileName);
  fs.writeFileSync(outputPath, canvas.toBuffer("image/png"));
  return outputPath;
}

export { generateImage, getRandomImage, getRandomWisdom };

