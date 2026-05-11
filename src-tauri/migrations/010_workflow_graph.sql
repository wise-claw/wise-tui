CREATE TABLE IF NOT EXISTS workflow_graphs (
    workflow_id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    graph_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
