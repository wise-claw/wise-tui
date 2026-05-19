-- Per-(assistant, scope) overrides for prompt layers, skills, MCPs, engineering.
--
-- Replaces the per-key storage in `app_settings` (`split_prompt_layers:*`) with
-- a structured table. A single row covers one (assistant_id, scope) tuple:
--   - assistant_id: "builtin:prd-split" / "custom:<uuid>"
--   - scope:        "assistant"          (applies to the assistant globally)
--                 | "project:<id>"       (project-specific overlay)
--                 | "repository:<id>"    (repository-specific overlay)
--
-- Each JSON column defaults to "{}" — a missing entry is equivalent to no
-- override. Resolution merges in order: platform default → builtin bundle
-- (assistant_default) → assistant scope → project scope → repository scope.
-- Field-non-empty wins, matching the existing splitPromptBundle.ts semantics.

CREATE TABLE IF NOT EXISTS assistant_overrides (
  assistant_id        TEXT NOT NULL,
  scope               TEXT NOT NULL,
  prompt_layers_json  TEXT NOT NULL DEFAULT '{}',
  skill_bundle_json   TEXT NOT NULL DEFAULT '{}',
  mcp_bundle_json     TEXT NOT NULL DEFAULT '{}',
  engineering_json    TEXT NOT NULL DEFAULT '{}',
  updated_at          INTEGER NOT NULL,
  PRIMARY KEY (assistant_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_assistant_overrides_scope
  ON assistant_overrides(scope, assistant_id);
