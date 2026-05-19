CREATE TABLE IF NOT EXISTS skills_external_path (
    id        TEXT PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    added_at  TEXT NOT NULL
);
