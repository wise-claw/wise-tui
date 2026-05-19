CREATE TABLE IF NOT EXISTS assistant_custom (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    avatar_color  TEXT,
    engine_id     TEXT NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    model         TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_custom_engine ON assistant_custom(engine_id);
