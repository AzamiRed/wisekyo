function normalizeQuote(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseQuoteArray(input) {
  let parsed;
  try {
    parsed = typeof input === "string" ? JSON.parse(input.replace(/^\uFEFF/, "")) : input;
  } catch {
    throw new Error("Ожидается корректный JSON-массив строк.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Цитаты должны быть переданы JSON-массивом.");
  }
  if (parsed.length > 5000) {
    throw new Error("За один раз можно загрузить не более 5000 элементов.");
  }

  const unique = new Set();
  let skipped = 0;
  for (const value of parsed) {
    if (typeof value !== "string") {
      skipped += 1;
      continue;
    }
    const quote = normalizeQuote(value);
    if (!quote || quote.length > 1000 || unique.has(quote)) {
      skipped += 1;
      continue;
    }
    unique.add(quote);
  }

  return { quotes: [...unique], skipped };
}

function detectImageType(buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  return null;
}

function getImageDimensions(buffer, mimeType) {
  if (mimeType === "image/png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType !== "image/jpeg") return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || offset + 4 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;
    offset += segmentLength + 2;
  }
  return null;
}

module.exports = { detectImageType, getImageDimensions, normalizeQuote, parseQuoteArray };
