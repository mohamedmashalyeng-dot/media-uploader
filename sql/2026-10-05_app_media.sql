CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name TEXT NOT NULL,
    original_file_name TEXT,
    object_key TEXT NOT NULL UNIQUE,
    public_url TEXT NOT NULL,
    media_type TEXT NOT NULL,
    mime_type TEXT,
    extension TEXT,
    size_bytes BIGINT,
    title TEXT,
    alt_text TEXT,
    caption TEXT,
    description TEXT,
    folder TEXT,
    width INTEGER,
    height INTEGER,
    duration_seconds NUMERIC,
    uploaded_by TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_media
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS app_media_created_at_idx
ON app_media (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS app_media_type_idx
ON app_media (media_type, created_at DESC);

CREATE INDEX IF NOT EXISTS app_media_folder_idx
ON app_media (folder, created_at DESC);

CREATE INDEX IF NOT EXISTS app_media_deleted_at_idx
ON app_media (deleted_at DESC, id DESC)
WHERE deleted_at IS NOT NULL;
