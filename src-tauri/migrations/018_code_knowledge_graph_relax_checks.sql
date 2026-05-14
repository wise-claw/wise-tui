-- Relax graph CHECK constraints (017 was too strict for api_operation / extended edge kinds).
-- Rebuild tables without CHECK; keep FK from edges → nodes.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS _gn_m18_edges;
DROP TABLE IF EXISTS _gn_m18_nodes;

CREATE TABLE _gn_m18_edges AS SELECT * FROM graph_edges;
CREATE TABLE _gn_m18_nodes AS SELECT * FROM graph_nodes;

DROP TABLE graph_edges;
DROP TABLE graph_nodes;

CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
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

CREATE TABLE graph_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id),
  target_id TEXT NOT NULL REFERENCES graph_nodes(id),
  kind TEXT NOT NULL,
  props TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO graph_nodes SELECT * FROM _gn_m18_nodes;
INSERT INTO graph_edges SELECT * FROM _gn_m18_edges;

DROP TABLE _gn_m18_edges;
DROP TABLE _gn_m18_nodes;

CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);

PRAGMA foreign_keys = ON;
