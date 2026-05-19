-- Migrate legacy `split_prompt_layers:*` rows from app_settings into the new
-- `assistant_overrides` table, attributing them to `builtin:prd-split`.
--
-- Mapping rules (storage layer is JSON-equivalent — we keep the layer payload
-- intact in `prompt_layers_json` so the previous "{schemaVersion:2,prompts:..}"
-- bundle survives. The frontend already understands both v1 and v2 layouts):
--
--   app_settings.key                           assistant_overrides row
--   ----------------------------------------   --------------------------------------------
--   split_prompt_layers:platform_default       (kept as-is for backward compat tests; the
--                                              builtin assistant default takes precedence
--                                              and is hardcoded in the Rust bundle layer.)
--   split_prompt_layers:project:<id>           assistant_id="builtin:prd-split", scope="project:<id>"
--   split_prompt_layers:repo:<id>              assistant_id="builtin:prd-split", scope="repository:<id>"
--
-- After copying, the per-project / per-repo rows are removed from app_settings.
-- The platform_default row stays in app_settings — nothing in the new path
-- reads it, but earlier seed-tests still assert its presence.
--
-- The INSERT uses OR IGNORE because re-running this migration on a database
-- that already migrated must be a no-op.

INSERT OR IGNORE INTO assistant_overrides (
  assistant_id, scope, prompt_layers_json,
  skill_bundle_json, mcp_bundle_json, engineering_json, updated_at
)
SELECT
  'builtin:prd-split',
  'project:' || substr(key, length('split_prompt_layers:project:') + 1),
  value,
  '{}', '{}', '{}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM app_settings
WHERE key LIKE 'split_prompt_layers:project:%';

INSERT OR IGNORE INTO assistant_overrides (
  assistant_id, scope, prompt_layers_json,
  skill_bundle_json, mcp_bundle_json, engineering_json, updated_at
)
SELECT
  'builtin:prd-split',
  'repository:' || substr(key, length('split_prompt_layers:repo:') + 1),
  value,
  '{}', '{}', '{}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM app_settings
WHERE key LIKE 'split_prompt_layers:repo:%';

DELETE FROM app_settings
 WHERE key LIKE 'split_prompt_layers:project:%'
    OR key LIKE 'split_prompt_layers:repo:%';
