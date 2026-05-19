CREATE TABLE IF NOT EXISTS mcp_server (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    transport   TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    source      TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(name, source)
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_source ON mcp_server(source);
CREATE INDEX IF NOT EXISTS idx_mcp_server_enabled ON mcp_server(enabled);
