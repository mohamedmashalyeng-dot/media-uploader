CREATE TABLE IF NOT EXISTS app_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS app_folders_name_key
ON app_folders (lower(name));

-- Folders used to exist only as a text value on media rows; keep them listed.
INSERT INTO app_folders (name)
SELECT DISTINCT ON (lower(folder)) folder
FROM app_media
WHERE folder IS NOT NULL AND folder <> ''
ORDER BY lower(folder), folder
ON CONFLICT ((lower(name))) DO NOTHING;
