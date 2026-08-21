CREATE TABLE IF NOT EXISTS generated_images (
  id BIGSERIAL PRIMARY KEY,
  data BYTEA NOT NULL CONSTRAINT generated_images_data_not_empty CHECK (octet_length(data) > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 1000),
  source TEXT NOT NULL CHECK (source IN ('random', 'chat', 'own')),
  chat_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS generated_images_created_at_idx
  ON generated_images (created_at DESC);
