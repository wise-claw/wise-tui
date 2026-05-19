# Implement — Refresh CLAUDE.md and Trellis specs

Execution checklist. Run top-to-bottom. Each step lists its source-of-truth
re-check, the edit, and the gate.

## Step 0 · Re-baseline

- [ ] `ls src/` → record top level
- [ ] `ls src-tauri/src/` → record top level (and subdirs we name)
- [ ] `ls src-tauri/migrations/` → confirm highest numeric prefix
- [ ] `ls ~/.wise/` → record durable dirs (filter to dirs/files we mention)
- [ ] `ls .trellis/spec/guides/` → confirm guide files

Gate: lists captured, no edits yet.

## Step 1 · `CLAUDE.md` — Frontend section

- [ ] `Edit` "### Frontend" block:
  - List window entries (`main.tsx`, `mascot.tsx`).
  - List app shell (`App.tsx`, `AppImpl.tsx`).
  - List feature/support dirs: `components/`, `hooks/`, `services/`,
    `services/workflow/`, `services/prdSplit/`, `services/mission/`,
    `services/trellis/`, `features/cc-wf-studio/`, `cc-workflow-studio-core/`,
    `stores/`, `notifications/`, `constants/`, `types/`, `types.ts`,
    `utils/`, `assets/`, `bootstrapDompurifyForTauriAssets.ts`.
- [ ] Keep the "no `src/pages/`" reminder.

Gate: Frontend bullet list reflects `ls src/` output.

## Step 2 · `CLAUDE.md` — Tauri Backend section

- [ ] `Edit` "### Tauri Backend" block grouped:
  - Entry: `main.rs`, `lib.rs`, `lib_impl.rs`.
  - Persistence/paths: `wise_db.rs`, `wise_paths.rs`,
    `app_state_commands/` (settings/workflow graph/run command groups).
  - Repository / fs: `repository_files.rs`, `git_commands.rs`,
    `project_workspace_paths.rs`, `workspace_commands.rs`.
  - PRD / split: `prd_materialize.rs`, `prd_url_fetch.rs`,
    `claude_commands/prd_split.rs`, `claude_commands/prd_split_pipeline.rs`.
  - Mission / Trellis runtime: `mission_control.rs`, `trellis_bootstrap.rs`,
    `trellis_runtime.rs`, `trellis_bridge.rs`.
  - Workflow studio: `cc_workflow_studio.rs`, `cc_wf_studio_mcp_bridge.rs`.
  - Claude subsystem: `claude_commands.rs`, `claude_commands/*.rs`,
    `claude_external_ingest.rs`, `claude_config_dir.rs`,
    `claude_code_usage.rs`.
  - Code knowledge graph: `code_knowledge_graph.rs`,
    `code_knowledge_graph/` submodules.
  - Integrations: `dingtalk_enterprise_bot.rs`,
    `dingtalk_stream_gateway.rs`, `wise_push.rs`, `cua_driver.rs`.
  - Skills / parsers: `skills_sh.rs`, `subagents_parser.rs`,
    `system_resource.rs`.
  - Mascot: `wise_mascot.rs`.
  - Config surfaces: `capabilities/default.json`, `tauri.conf.json` (already
    listed; keep).

Gate: every Rust file in `ls src-tauri/src/` has a category here.

## Step 3 · `CLAUDE.md` — Storage section

- [ ] `Edit` to include `prd-runs/` alongside `prd-images/` and any other
  durable file/dir present under `~/.wise/`.

Gate: `ls ~/.wise/` and section content match for app-owned writes.

## Step 4 · `CLAUDE.md` — New "Trellis Spec & Skills" pointer block

- [ ] `Edit` to insert after the existing "Coding Rules" section, before
  "UI System Policy":
  - Heading `## Trellis Spec & Skills`.
  - 3-row table linking to:
    - `.trellis/spec/frontend/index.md` — frontend rules.
    - `.trellis/spec/tauri/index.md` — Tauri / Rust IPC / persistence.
    - `.trellis/spec/guides/index.md` — cross-layer thinking, commit hygiene,
      Trellis subagent prompts.
  - Callout: `agent-harness-architecture.md` is the product constitution;
    update before changing top-level layout, ViewMode, or Trellis ↔ Mission
    contracts.

Gate: section present; GitNexus markers untouched.

## Step 5 · `.trellis/spec/frontend/directory-structure.md`

- [ ] `Edit` the ASCII tree to reflect today's `src/` (add `AppImpl.tsx`,
  `bootstrapDompurifyForTauriAssets.ts`, `cc-workflow-studio-core/`,
  `features/`, `notifications/`, `stores/`).
- [ ] `Edit` "Module Organization" example list to point at modules that
  exist (`src/services/prdSplit/`, `src/services/workflow/`,
  `src/features/cc-wf-studio/`).

Gate: every entry in the tree exists; non-existent entries removed.

## Step 6 · `.trellis/spec/tauri/index.md`

- [ ] `Edit` "Canonical Examples" to a domain-grouped list (DB, paths,
  repository fs, PRD materialize, Mission/Trellis runtime, workflow studio,
  knowledge graph, integrations, services wrappers).
- [ ] Each referenced file exists in `src-tauri/src/` or `src/services/`.

Gate: `grep` each filename in the section to confirm it exists.

## Step 7 · `.trellis/spec/tauri/persistence-and-migrations.md`

- [ ] `Edit` "Migrations" section to mention current numeric range
  (`001_init.sql` … `022_trellis_runtime.sql`) and that the include list
  lives in `wise_db.rs`.

Gate: range string matches `ls src-tauri/migrations/`.

## Step 8 · `.trellis/spec/guides/index.md`

- [ ] `Edit` to add a "Quick Reference" callout at the top (or right under
  "Why Thinking Guides?") naming `agent-harness-architecture.md` as the
  product constitution to update first when layout / ViewMode / Trellis ↔
  Mission contracts change.
- [ ] Verify the table rows still match the files under
  `.trellis/spec/guides/`.

Gate: table covers all 6 markdown files; callout present.

## Step 9 · Verify

- [ ] `git status --short` shows only edits to `CLAUDE.md`,
  `.trellis/spec/**`, and `.trellis/tasks/05-17-refresh-claude-md-and-spec/**`.
  No `src/`, no `src-tauri/`, no `AionUi-main/`.
- [ ] `grep -nF "<!-- gitnexus:start -->" CLAUDE.md` and
  `grep -nF "<!-- gitnexus:end -->" CLAUDE.md` both return 1 hit.
- [ ] `grep -nF "src/pages" CLAUDE.md .trellis/spec/frontend/` returns no
  recommendations to add a `pages/` directory.
- [ ] No `Arco`, `UnoCSS`, `Electron`, `oxlint`, `oxfmt`, `prek` strings
  introduced into wise files.

Gate: clean diff, expected scope only.

## Step 10 · Hand-off

- [ ] Update `task.json` status to `completed` via `task.py finish`.
- [ ] No commit yet — leave the docs change in working tree for the user to
  review and stage.
