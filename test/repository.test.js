const test = require("node:test");
const assert = require("node:assert/strict");
const { ContentRepository } = require("../src/repository");

test("generated image data and metadata are inserted together", async () => {
  let query;
  const pool = {
    query: async (text, values) => {
      query = { text, values };
      return { rows: [{ id: "1", created_at: new Date() }] };
    },
  };
  const repository = new ContentRepository(pool);
  const data = Buffer.from("png");

  await repository.insertGeneratedImage({
    data,
    text: "Цитата",
    source: "random",
    chatId: 42,
    userId: 42,
    username: "wise_user",
    displayName: "Wise User",
  });

  assert.match(query.text, /INSERT INTO generated_images/);
  assert.deepEqual(query.values, [data, "Цитата", "random", 42, 42, "wise_user", "Wise User"]);
});

test("insertLog stores entry and trims old rows", async () => {
  const queries = [];
  const pool = {
    query: async (text, values) => {
      queries.push({ text, values });
      if (/INSERT INTO app_logs/.test(text)) {
        return { rows: [{ id: "9", created_at: new Date() }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new ContentRepository(pool);

  const row = await repository.insertLog({
    level: "error",
    source: "bot",
    message: "Boom",
    details: "stack",
  });

  assert.equal(row.id, "9");
  assert.match(queries[0].text, /INSERT INTO app_logs/);
  assert.deepEqual(queries[0].values, ["error", "bot", "Boom", "stack"]);
  assert.match(queries[1].text, /DELETE FROM app_logs/);
  assert.deepEqual(queries[1].values, [1000]);
});

test("listLogs filters by level when requested", async () => {
  const queries = [];
  const pool = {
    query: async (text, values) => {
      queries.push({ text, values });
      return { rows: [{ id: 1, level: "error", source: "bot", message: "x", details: null, created_at: new Date() }] };
    },
  };
  const repository = new ContentRepository(pool);

  await repository.listLogs({ limit: 50, level: "error" });
  await repository.listLogs({ limit: 10 });

  assert.match(queries[0].text, /WHERE level = \$1/);
  assert.deepEqual(queries[0].values, ["error", 50]);
  assert.doesNotMatch(queries[1].text, /WHERE level/);
  assert.deepEqual(queries[1].values, [10]);
});

test("admin account helpers list create and count without password hashes", async () => {
  const queries = [];
  const pool = {
    query: async (text, values) => {
      queries.push({ text, values });
      if (/COUNT/.test(text)) return { rows: [{ count: 2 }] };
      if (/INSERT INTO admins/.test(text)) {
        return { rows: [{ id: "2", username: values[0], created_at: new Date() }] };
      }
      return {
        rows: [{ id: "1", username: "admin", created_at: new Date() }],
      };
    },
  };
  const repository = new ContentRepository(pool);

  await repository.listAdmins();
  const count = await repository.countAdmins();
  await repository.createAdmin({ username: "operator", passwordHash: "hash" });
  await repository.deleteAdmin(2);

  assert.match(queries[0].text, /SELECT id, username, created_at FROM admins/);
  assert.doesNotMatch(queries[0].text, /password_hash/);
  assert.equal(count, 2);
  assert.deepEqual(queries[2].values, ["operator", "hash"]);
  assert.deepEqual(queries[3].values, [2]);
});
