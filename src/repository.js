class ContentRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async getRandomQuote() {
    const result = await this.pool.query(
      "SELECT id, text FROM quotes WHERE active = TRUE ORDER BY random() LIMIT 1"
    );
    return result.rows[0] || null;
  }

  async getRandomImage() {
    const result = await this.pool.query(
      "SELECT id, original_name, mime_type, data FROM images WHERE active = TRUE ORDER BY random() LIMIT 1"
    );
    return result.rows[0] || null;
  }

  async listQuotes(limit = 200) {
    const result = await this.pool.query(
      "SELECT id, text, active, created_at FROM quotes ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return result.rows;
  }

  async insertQuotes(quotes) {
    if (!quotes.length) return [];
    const result = await this.pool.query(
      `INSERT INTO quotes (text)
       SELECT value FROM unnest($1::text[]) AS value
       ON CONFLICT (text) DO NOTHING
       RETURNING id, text`,
      [quotes]
    );
    return result.rows;
  }

  async setQuoteActive(id, active) {
    const result = await this.pool.query(
      "UPDATE quotes SET active = $2 WHERE id = $1 RETURNING id",
      [id, active]
    );
    return result.rowCount > 0;
  }

  async deleteQuote(id) {
    const result = await this.pool.query("DELETE FROM quotes WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async listImages(limit = 200) {
    const result = await this.pool.query(
      `SELECT id, original_name, mime_type, active, created_at
       FROM images ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async getImage(id) {
    const result = await this.pool.query(
      "SELECT id, original_name, mime_type, data, active FROM images WHERE id = $1",
      [id]
    );
    return result.rows[0] || null;
  }

  async insertImage({ originalName, mimeType, data }) {
    const result = await this.pool.query(
      `INSERT INTO images (original_name, mime_type, data)
       VALUES ($1, $2, $3)
       RETURNING id, original_name, mime_type, active`,
      [originalName, mimeType, data]
    );
    return result.rows[0];
  }

  async setImageActive(id, active) {
    const result = await this.pool.query(
      "UPDATE images SET active = $2 WHERE id = $1 RETURNING id",
      [id, active]
    );
    return result.rowCount > 0;
  }

  async deleteImage(id) {
    const result = await this.pool.query("DELETE FROM images WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async insertGeneratedImage({ data, text, source, chatId, userId, username, displayName }) {
    const result = await this.pool.query(
      `INSERT INTO generated_images (data, text, source, chat_id, user_id, username, display_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [data, text, source, chatId, userId ?? null, username ?? null, displayName ?? null]
    );
    return result.rows[0];
  }

  async listGeneratedImages(limit = 200) {
    const result = await this.pool.query(
      `SELECT id, text, source, chat_id, user_id, username, display_name, created_at
       FROM generated_images
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async getGeneratedImage(id) {
    const result = await this.pool.query(
      `SELECT id, data, text, source, chat_id, user_id, username, display_name, created_at
       FROM generated_images WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async deleteGeneratedImage(id) {
    const result = await this.pool.query("DELETE FROM generated_images WHERE id = $1", [id]);
    return result.rowCount > 0;
  }

  async insertLog({ level, source, message, details }) {
    const result = await this.pool.query(
      `INSERT INTO app_logs (level, source, message, details)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [
        level,
        String(source || "app").slice(0, 64),
        String(message || "Unknown error").slice(0, 2000),
        details == null ? null : String(details).slice(0, 20000),
      ]
    );
    await this.trimLogs(1000);
    return result.rows[0];
  }

  async listLogs({ limit = 300, level } = {}) {
    if (level) {
      const result = await this.pool.query(
        `SELECT id, level, source, message, details, created_at
         FROM app_logs
         WHERE level = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [level, limit]
      );
      return result.rows;
    }
    const result = await this.pool.query(
      `SELECT id, level, source, message, details, created_at
       FROM app_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async trimLogs(keep = 1000) {
    await this.pool.query(
      `DELETE FROM app_logs
       WHERE id NOT IN (
         SELECT id FROM app_logs ORDER BY created_at DESC, id DESC LIMIT $1
       )`,
      [keep]
    );
  }

  async clearLogs() {
    await this.pool.query("TRUNCATE app_logs RESTART IDENTITY");
  }

  async findAdmin(username) {
    const result = await this.pool.query(
      "SELECT id, username, password_hash FROM admins WHERE lower(username) = lower($1)",
      [username]
    );
    return result.rows[0] || null;
  }

  async listAdmins() {
    const result = await this.pool.query(
      "SELECT id, username, created_at FROM admins ORDER BY created_at ASC, id ASC"
    );
    return result.rows;
  }

  async countAdmins() {
    const result = await this.pool.query("SELECT COUNT(*)::int AS count FROM admins");
    return result.rows[0]?.count || 0;
  }

  async createAdmin({ username, passwordHash }) {
    const result = await this.pool.query(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, created_at`,
      [username, passwordHash]
    );
    return result.rows[0];
  }

  async deleteAdmin(id) {
    const result = await this.pool.query("DELETE FROM admins WHERE id = $1", [id]);
    return result.rowCount > 0;
  }
}

module.exports = { ContentRepository };
