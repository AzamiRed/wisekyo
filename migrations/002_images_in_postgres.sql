ALTER TABLE images ADD COLUMN IF NOT EXISTS data BYTEA;

-- Legacy rows only contained S3 keys and cannot work without S3.
DELETE FROM images WHERE data IS NULL;

ALTER TABLE images ALTER COLUMN data SET NOT NULL;
ALTER TABLE images DROP COLUMN IF EXISTS object_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'images_data_not_empty'
  ) THEN
    ALTER TABLE images
      ADD CONSTRAINT images_data_not_empty CHECK (octet_length(data) > 0);
  END IF;
END $$;
