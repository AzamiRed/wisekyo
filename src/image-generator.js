const fs = require("fs");
const { createCanvas, loadImage, registerFont } = require("canvas");

function splitLongWord(ctx, word, maxWidth) {
  const parts = [];
  let part = "";
  for (const character of word) {
    const candidate = part + character;
    if (part && ctx.measureText(candidate).width > maxWidth) {
      parts.push(part);
      part = character;
    } else {
      part = candidate;
    }
  }
  if (part) parts.push(part);
  return parts;
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  const words = text.trim().split(/\s+/).flatMap((word) =>
    ctx.measureText(word).width > maxWidth ? splitLongWord(ctx, word, maxWidth) : [word]
  );

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createImageGenerator({ repository, fontPath, logger }) {
  let fontFamily = "sans-serif";
  if (fontPath && fs.existsSync(fontPath)) {
    registerFont(fontPath, { family: "Impact" });
    fontFamily = "Impact";
  } else {
    console.warn("Impact font was not found; using the system sans-serif font.");
  }

  return async function generateImage(text) {
    const normalizedText = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!normalizedText) throw new Error("EMPTY_TEXT");

    const imageRecord = await repository.getRandomImage();
    if (!imageRecord) throw new Error("NO_ACTIVE_IMAGES");

    try {
      const image = await loadImage(imageRecord.data);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);

      let fontSize = Math.max(28, Math.min(60, Math.round(image.width / 12)));
      let lineHeight;
      let lines;
      const maxWidth = Math.max(100, image.width - 100);
      do {
        ctx.font = `${fontSize}px "${fontFamily}"`;
        lineHeight = Math.round(fontSize * 1.17);
        lines = wrapText(ctx, normalizedText, maxWidth);
        if (lines.length * lineHeight <= image.height - 80 || fontSize <= 20) break;
        fontSize -= 2;
      } while (fontSize >= 20);

      ctx.fillStyle = "white";
      ctx.strokeStyle = "black";
      ctx.lineWidth = Math.max(3, Math.round(fontSize / 12));
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";

      const availableLines = Math.max(1, Math.floor((image.height - 80) / lineHeight));
      const visibleLines = lines.slice(0, availableLines);
      const startY = image.height - 45 - (visibleLines.length - 1) * lineHeight;

      visibleLines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        ctx.strokeText(line, image.width / 2, y);
        ctx.fillText(line, image.width / 2, y);
      });

      return canvas.toBuffer("image/png");
    } catch (error) {
      if (logger?.error) {
        await logger.error(
          "generator",
          `Failed to render image id=${imageRecord.id}`,
          error
        );
      }
      throw error;
    }
  };
}

module.exports = { createImageGenerator, splitLongWord, wrapText };
