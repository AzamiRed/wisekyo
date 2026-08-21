CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL UNIQUE CHECK (length(text) BETWEEN 1 AND 1000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS images (
  id BIGSERIAL PRIMARY KEY,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
  data BYTEA NOT NULL CONSTRAINT images_data_not_empty CHECK (octet_length(data) > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_images (
  id BIGSERIAL PRIMARY KEY,
  data BYTEA NOT NULL CONSTRAINT generated_images_data_not_empty CHECK (octet_length(data) > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  source TEXT NOT NULL CHECK (source IN ('random', 'chat', 'own')),
  chat_id BIGINT,
  user_id BIGINT,
  username TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL PRIMARY KEY,
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON "session" ("expire");
CREATE UNIQUE INDEX IF NOT EXISTS admins_username_lower_idx ON admins (lower(username));
CREATE INDEX IF NOT EXISTS quotes_active_idx ON quotes (active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS images_active_idx ON images (active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS generated_images_created_at_idx ON generated_images (created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_created_at_idx ON app_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS app_logs_level_idx ON app_logs (level);
