-- Migration 041: Code Knowledge Graph feature removed; drop legacy graph tables.

DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
DROP TABLE IF EXISTS graph_index_meta;
