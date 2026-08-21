const test = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas } = require("canvas");
const { detectImageType, getImageDimensions, parseQuoteArray } = require("../src/content");

test("parseQuoteArray normalizes and deduplicates quotes", () => {
  const result = parseQuoteArray('["  Первая   цитата ", "Вторая", "Вторая", "", 42]');
  assert.deepEqual(result.quotes, ["Первая цитата", "Вторая"]);
  assert.equal(result.skipped, 3);
});

test("parseQuoteArray rejects non-array JSON", () => {
  assert.throws(() => parseQuoteArray('{"text":"quote"}'), /JSON-массивом/);
});

test("detectImageType checks file signatures instead of extensions", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.deepEqual(detectImageType(png), { mimeType: "image/png", extension: "png" });
  assert.deepEqual(detectImageType(jpeg), { mimeType: "image/jpeg", extension: "jpg" });
  assert.equal(detectImageType(Buffer.from("not an image")), null);
});

test("getImageDimensions reads dimensions before full image decoding", () => {
  const png = createCanvas(320, 180).toBuffer("image/png");
  assert.deepEqual(getImageDimensions(png, "image/png"), { width: 320, height: 180 });
});
