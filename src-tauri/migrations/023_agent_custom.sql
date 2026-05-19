CREATE TABLE IF NOT EXISTS agent_custom (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    args_json   TEXT NOT NULL DEFAULT '[]',
    env_json    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
