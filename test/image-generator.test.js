const test = require("node:test");
const assert = require("node:assert/strict");
const { createCanvas } = require("canvas");
const { createImageGenerator } = require("../src/image-generator");

test("image generator returns a PNG buffer from PostgreSQL image data", async () => {
  const background = createCanvas(600, 400).toBuffer("image/png");
  const repository = {
    getRandomImage: async () => ({ data: background }),
  };
  const generate = createImageGenerator({ repository, fontPath: null });

  const result = await generate("Тестовая цитата");
  assert.equal(result.subarray(1, 4).toString("ascii"), "PNG");
});

test("image generator reports an empty image collection", async () => {
  const generate = createImageGenerator({
    repository: { getRandomImage: async () => null },
    fontPath: null,
  });
  await assert.rejects(generate("Цитата"), /NO_ACTIVE_IMAGES/);
});
