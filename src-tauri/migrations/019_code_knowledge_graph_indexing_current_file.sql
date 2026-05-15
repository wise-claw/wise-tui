-- Progress hint while indexing: which source file is being read/parsed (may be slow).
ALTER TABLE graph_index_meta ADD COLUMN indexing_current_file TEXT;
