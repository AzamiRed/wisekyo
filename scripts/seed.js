const fs = require("fs/promises");
const path = require("path");
const bcrypt = require("bcryptjs");
const { loadConfig } = require("../src/config");
const { createPool } = require("../src/db");
const { normalizeQuote } = require("../src/content");
const { ContentRepository } = require("../src/repository");

async function seedQuotes(repository) {
  const wisdomPath = path.join(__dirname, "..", "wisdom.txt");
  try {
    await fs.access(wisdomPath);
  } catch {
    console.log("Quotes: skipped (wisdom.txt not found).");
    return;
  }

  const source = await fs.readFile(wisdomPath, "utf8");
  const quotes = [
    ...new Set(source.split(/\r?\n/).map(normalizeQuote).filter(Boolean)),
  ];
  const inserted = await repository.insertQuotes(quotes);
  console.log(`Quotes: inserted ${inserted.length}, already present ${quotes.length - inserted.length}.`);
}

async function seedAdmin(pool) {
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.log("Admin: skipped (set ADMIN_USERNAME and ADMIN_PASSWORD to create one).");
    return;
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
    [username, passwordHash]
  );
  console.log(`Admin: ${username} is ready.`);
}

async function main() {
  const config = loadConfig({ ...process.env, BOT_ENABLED: "false" });
  const pool = createPool(config);
  try {
    await seedQuotes(new ContentRepository(pool));
    await seedAdmin(pool);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
