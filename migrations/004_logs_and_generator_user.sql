CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_logs_created_at_idx ON app_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_idx ON app_logs (level);

ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE generated_images ADD COLUMN IF NOT EXISTS display_name TEXT;
