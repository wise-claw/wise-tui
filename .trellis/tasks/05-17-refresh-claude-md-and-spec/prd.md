# Refresh CLAUDE.md and Trellis specs to current codebase

## Goal

Refresh the root `CLAUDE.md` and `.trellis/spec/{frontend,tauri,guides}` so they
accurately describe the current `src/` and `src-tauri/src/` layout, the active
Tauri command surface, and the durable-state contract under `~/.wise/`. Also
add a project-wide Skills / Agent-Harness pointer block to `CLAUDE.md`,
modeled on AionUi-main's structure but written for wise's actual stack.

This is a documentation-only change. No production code, migration, or
configuration is modified.

## Background

- AionUi-main (untracked reference at repo root) ships a tightly organized
  `CLAUDE.md` + `.claude/skills/` index. Its **structure** (skills index,
  explicit forbidden patterns, scoped contributor rules) is worth borrowing.
  Its **content** is for an Electron + Arco + UnoCSS app and must not leak in.
- wise's `CLAUDE.md` was last meaningfully updated before several modules
  landed: `mission_control.rs`, `trellis_runtime.rs`, `trellis_bridge.rs`,
  `cc_workflow_studio.rs`, `cua_driver.rs`, `code_knowledge_graph/`,
  `dingtalk_*.rs`, `cc_wf_studio_mcp_bridge.rs`, plus frontend
  `src/AppImpl.tsx`, `src/features/cc-wf-studio/`, `src/cc-workflow-studio-core/`,
  `src/stores/`, `src/notifications/`, and `src/constants/`.
- `.trellis/spec/frontend/directory-structure.md` only lists a partial src
  tree. `.trellis/spec/tauri/index.md` "Canonical Examples" lists a small
  subset of Rust modules and predates the `app_state_commands/` and
  `claude_commands/` submodule split. Migration index in
  `persistence-and-migrations.md` does not mention the current range
  (`001_init.sql` … `022_trellis_runtime.sql`).
- `.trellis/spec/guides/index.md` is current, but should be cross-linked from
  `CLAUDE.md` so new agents discover `agent-harness-architecture.md` (the
  product constitution) early.

## Requirements

### R1 — Refresh root `CLAUDE.md`

- Update the "Architecture / Frontend" section so it lists every top-level
  `src/` directory that exists today, including: `App.tsx`, `AppImpl.tsx`,
  `main.tsx`, `mascot.tsx`, `components/`, `hooks/`, `services/`, `stores/`,
  `notifications/`, `constants/`, `features/`, `cc-workflow-studio-core/`,
  `types/`, `utils/`, `assets/`. Keep one-line descriptions only.
- Update the "Architecture / Tauri Backend" section so it covers the actual
  Rust surface (`mission_control.rs`, `trellis_runtime.rs`, `trellis_bridge.rs`,
  `trellis_bootstrap.rs`, `cc_workflow_studio.rs`,
  `cc_wf_studio_mcp_bridge.rs`, `cua_driver.rs`, `code_knowledge_graph/`,
  `dingtalk_enterprise_bot.rs`, `dingtalk_stream_gateway.rs`, `git_commands.rs`,
  `prd_url_fetch.rs`, `project_workspace_paths.rs`, `subagents_parser.rs`,
  `system_resource.rs`, `wise_mascot.rs`, `wise_push.rs`,
  `workspace_commands.rs`, `app_state_commands/`, `claude_commands/`).
- Add a "Trellis Spec & Skills" block: short pointer table to
  `.trellis/spec/frontend/index.md`, `.trellis/spec/tauri/index.md`,
  `.trellis/spec/guides/index.md`, and explicitly call out
  `agent-harness-architecture.md` as the product constitution.
- Update "Storage" so it lists the durable layout under `~/.wise/` matching
  what's there today (include `prd-runs/` along with `prd-images/`).
- Keep the existing GitNexus block as-is between its markers.
- Keep the existing UI System Policy and Commit Conventions sections.

### R2 — Refresh `.trellis/spec/frontend/directory-structure.md`

- The ASCII tree must match the actual top-level layout of `src/`:
  add `AppImpl.tsx`, `bootstrapDompurifyForTauriAssets.ts`, `cc-workflow-studio-core/`,
  `features/`, `notifications/`, `stores/` (currently missing), and verify
  every other entry still exists.
- Update "Module Organization" examples so at least one example points at a
  current real module (e.g., `src/services/prdSplit/`,
  `src/services/workflow/`, `src/features/cc-wf-studio/`).
- Do not introduce a `pages/` directory recommendation. Existing rule stands.

### R3 — Refresh `.trellis/spec/tauri/index.md`

- Update "Canonical Examples" so it covers the current Rust module set
  (the grouping used in R1 is the source of truth). Group examples by domain
  (DB, paths, repository fs, PRD materialize, mission control, Trellis
  runtime/bridge, code knowledge graph, dingtalk, skills/CUA).
- Verify every referenced filename exists.

### R4 — Refresh `.trellis/spec/tauri/persistence-and-migrations.md`

- Update the Migrations section to note the current numeric range
  (001 … 022 today) and that the include list lives in `wise_db.rs`.
- No content rewrite of the Scenario block; it is still accurate.

### R5 — Refresh `.trellis/spec/guides/index.md`

- Confirm the table accurately lists every `.md` under
  `.trellis/spec/guides/` (`agent-harness-architecture.md`,
  `code-reuse-thinking-guide.md`, `commit-hygiene.md`,
  `cross-layer-thinking-guide.md`, `trellis-splitter-prompt.md`,
  `trellis-verifier-prompt.md`).
- Add a short "Quick Reference" callout: when changing top-level layout,
  ViewMode, or Trellis ↔ Mission contracts, update
  `agent-harness-architecture.md` first.

### R6 — Cross-link surfaces

- `CLAUDE.md` links into `.trellis/spec/*` index files.
- Each spec `index.md` already cross-references the others; verify no broken
  paths after edits.

## Constraints

- Documentation-only. Do not edit `src/`, `src-tauri/`, scripts, or
  configuration.
- No new dependencies, no new top-level files outside the existing
  doc/spec/task surfaces.
- Keep wording consistent with existing wise spec voice (English, declarative,
  short sentences). Do not inject AionUi product names, Arco UI rules, or
  UnoCSS rules.
- Preserve markers like `<!-- gitnexus:start -->` / `<!-- gitnexus:end -->` and
  `<!-- TRELLIS:START -->` / `<!-- TRELLIS:END -->` blocks; do not touch the
  managed AGENTS.md Trellis block.
- Do not run dev/build/start commands. Verification is reading + grep.

## Acceptance Criteria

- [ ] `CLAUDE.md` Frontend section enumerates every directory and entry file
      currently in `src/` at the top level.
- [ ] `CLAUDE.md` Tauri Backend section enumerates every `.rs` file and
      submodule directory currently in `src-tauri/src/`.
- [ ] `CLAUDE.md` includes a "Trellis Spec & Skills" pointer block linking
      to the three `.trellis/spec/*/index.md` files and explicitly naming
      `agent-harness-architecture.md` as the product constitution.
- [ ] `CLAUDE.md` Storage section lists every directory currently under
      `~/.wise/` that the app writes (including `prd-runs/`).
- [ ] `.trellis/spec/frontend/directory-structure.md` ASCII tree matches the
      current `src/` top level (verified by listing the dir).
- [ ] `.trellis/spec/tauri/index.md` Canonical Examples references only files
      that exist today and covers each major Rust domain in the project.
- [ ] `.trellis/spec/tauri/persistence-and-migrations.md` Migrations section
      reflects the present numeric range (001 … 022).
- [ ] `.trellis/spec/guides/index.md` table matches the actual files under
      `.trellis/spec/guides/` and adds the Quick Reference callout.
- [ ] No code, config, or migration files outside `CLAUDE.md` and
      `.trellis/spec/**` are modified.
- [ ] `bun test` is **not** required for this task because no source code
      changes; verification is grep + directory listing only.

## Out of Scope

- Rewriting agent-harness-architecture.md content.
- Renaming `floatingRepositories` → `standaloneRepos` in code.
- Re-organizing `src/` or `src-tauri/src/` directories.
- Adding a project-level `AGENTS.md` (wise already has the managed Trellis
  block in `AGENTS.md`; do not duplicate guidance).
- Adding new Trellis skills/agents.

## Notes

- AionUi-main is referenced for **structure** only. Treat it as read-only;
  do not mirror its UI library, naming, or PR-automation skills into wise.
- Keep frontmatter and existing markers intact. Edits should be surgical.
