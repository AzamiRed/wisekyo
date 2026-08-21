const fs = require("fs/promises");
const path = require("path");
const { loadConfig } = require("../src/config");
const { createPool } = require("../src/db");

async function main() {
  const config = loadConfig({ ...process.env, BOT_ENABLED: "false" });
  const pool = createPool(config);
  try {
    const migrationsFolder = path.join(__dirname, "..", "migrations");
    const migrations = (await fs.readdir(migrationsFolder))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const migration of migrations) {
      const sql = await fs.readFile(path.join(migrationsFolder, migration), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
        console.log(`Applied ${migration}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    console.log("Database migration completed.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
