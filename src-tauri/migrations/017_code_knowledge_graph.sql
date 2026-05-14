-- Migration 017: Code Knowledge Graph tables

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('repo','folder','file','symbol')),
  symbol_kind TEXT,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  range_start_line INTEGER,
  range_start_col INTEGER,
  range_end_line INTEGER,
  range_end_col INTEGER,
  content_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  kind TEXT NOT NULL CHECK(kind IN ('contains','imports','calls','implements')),
  props TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);

CREATE TABLE IF NOT EXISTS graph_index_meta (
  repo_id INTEGER PRIMARY KEY,
  index_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  total_nodes INTEGER DEFAULT 0,
  total_edges INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
