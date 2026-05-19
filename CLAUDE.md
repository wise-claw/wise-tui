# CLAUDE.md

This file provides Claude Code guidance for this repository. Trellis specs are the main source of truth for detailed coding rules.

## Project Overview

Wise is a Tauri 2 desktop orchestration client built with Bun, Vite, React 19, TypeScript, Ant Design, Semi UI, and Rust. It manages local repositories, Claude Code sessions, workflow graphs, PRD task splitting, terminal/Git panels, MCP/skills surfaces, notifications, and SQLite-backed project state.

## Commands

```bash
bun install
bun test
bun run build
bun run tauri:dev
bun run tauri:build
bun run tauri
```

Use Bun only. `bun.lock` is the tracked lockfile.

Project rule for AI agents: do not run frontend dev/build/start/serve commands unless the user explicitly allows it. Prefer `bun test`, targeted code inspection, and static checks that do not start a dev server.

Product evolution rule: Wise is being productized toward an AionUi-style AI workbench. Backend changes are allowed when they support that direction, but existing backend capabilities must not be deleted. Prefer migrating, merging, or wrapping existing functionality into clearer Hub / Channel / Automation / Artifact surfaces instead of removing commands, data, or integration paths.

## Architecture

### Frontend

Window entries:

- `src/main.tsx`: main window React entry.
- `src/mascot.tsx`: mascot window React entry.

App shell:

- `src/App.tsx`: desktop workspace shell and app-wide coordination.
- `src/AppImpl.tsx`: workspace implementation surface invoked by `App.tsx`.
- `src/bootstrapDompurifyForTauriAssets.ts`: DOMPurify bootstrap for `asset://` resources.

Feature and support modules:

- `src/components/`: feature and shared UI surfaces.
- `src/hooks/`: reusable stateful orchestration.
- `src/services/`: Tauri IPC wrappers and pure service modules.
- `src/services/workflow/`: workflow engine, facade, replay, event store, adapters.
- `src/services/prdSplit/`: PRD split planning, dispatch, verification, persistence helpers.
- `src/services/mission/`: mission session binding helpers.
- `src/services/trellis/`: Trellis SDD-mode detection helpers.
- `src/features/cc-wf-studio/`: cc-workflow-studio host integration (Wise side).
- `src/cc-workflow-studio-core/`: pure workflow definition and prompt generation.
- `src/stores/`: small external subscription stores for cross-component runtime state.
- `src/notifications/`: notification hub, ingest, and shared types.
- `src/constants/`: shared constants and event names.
- `src/types/`: domain type modules (workflow, requirements index, view mode, etc.).
- `src/types.ts`: legacy shared cross-domain types.
- `src/utils/`: pure helpers.
- `src/assets/`: static frontend assets.

There is no route-based `src/pages/` architecture. Do not add `pages/` unless real routing is introduced.

### Tauri Backend

App entry and setup:

- `src-tauri/src/main.rs`: process entry.
- `src-tauri/src/lib.rs`, `src-tauri/src/lib_impl.rs`: app setup and command registration.

Persistence and paths:

- `src-tauri/src/wise_db.rs`: SQLite setup, migration include list, shared DB state.
- `src-tauri/src/wise_paths.rs`: `~/.wise` path and atomic file helpers.
- `src-tauri/src/app_state_commands.rs` and `src-tauri/src/app_state_commands/`: settings, workflow graph, and workflow run command groups.

Repository and workspace filesystem:

- `src-tauri/src/repository_files.rs`: repository explorer/search/create/delete commands.
- `src-tauri/src/git_commands.rs`: git status, diff, and history commands.
- `src-tauri/src/project_workspace_paths.rs`: project workspace path resolution.
- `src-tauri/src/workspace_commands.rs`: workspace-level commands.

PRD and split:

- `src-tauri/src/prd_materialize.rs`: PRD asset materialization and path canonicalization.
- `src-tauri/src/prd_url_fetch.rs`: PRD URL fetching commands.
- `src-tauri/src/claude_commands/prd_split.rs`, `src-tauri/src/claude_commands/prd_split_pipeline.rs`: PRD split execution and pipeline commands.

Mission and Trellis runtime:

- `src-tauri/src/mission_control.rs`: Mission persistence, runs, assignments, evidence.
- `src-tauri/src/trellis_bootstrap.rs`: Trellis bootstrap and project detection.
- `src-tauri/src/trellis_runtime.rs`: Trellis runtime events and agent runs.
- `src-tauri/src/trellis_bridge.rs`: Trellis ↔ Mission bridging.

Workflow studio:

- `src-tauri/src/cc_workflow_studio.rs`: cc-workflow-studio backend integration.
- `src-tauri/src/cc_wf_studio_mcp_bridge.rs`: cc-workflow-studio MCP bridge.

Claude subsystem:

- `src-tauri/src/claude_commands.rs` and `src-tauri/src/claude_commands/`: Claude session commands (attachments, disk sessions, MCP, skills, subagents, terminal, shared helpers).
- `src-tauri/src/claude_external_ingest.rs`: external Claude ingest path.
- `src-tauri/src/claude_config_dir.rs`: Claude config directory commands.
- `src-tauri/src/claude_code_usage.rs`: Claude Code usage statistics.

Code knowledge graph:

- `src-tauri/src/code_knowledge_graph.rs` and `src-tauri/src/code_knowledge_graph/`: indexer, storage, search, language extractors, and synthetic OpenAPI helpers.

Integrations:

- `src-tauri/src/dingtalk_enterprise_bot.rs`, `src-tauri/src/dingtalk_stream_gateway.rs`: DingTalk bot and stream gateway integrations.
- `src-tauri/src/wise_push.rs`: push notification surface.
- `src-tauri/src/cua_driver.rs`: CUA driver integration.

Skills and parsers:

- `src-tauri/src/skills_sh.rs`: project skills.sh execution.
- `src-tauri/src/subagents_parser.rs`: subagent metadata parsing.
- `src-tauri/src/system_resource.rs`: system resource probes.

Mascot:

- `src-tauri/src/wise_mascot.rs`: mascot window state.

Config surfaces:

- `src-tauri/capabilities/default.json`: explicit Tauri 2 permissions.
- `src-tauri/tauri.conf.json`: windows, bundle config, asset protocol scope.
- `src-tauri/migrations/`: numbered SQL migrations included from `wise_db.rs`.

## Storage

Application-owned durable data lives under `~/.wise/`:

- `wise.db`: SQLite database (projects, workflows, sessions, mission, knowledge graph).
- `repositories.json`: registered repositories.
- `tabs.json`: tab session state.
- `prd-images/`: materialized PRD images.
- `prd-runs/`: per-cluster PRD split run artifacts.

Do not store durable project/workflow/session metadata in browser `localStorage` unless an existing compatibility path explicitly requires it.

## Coding Rules

Read these before implementation:

- `.trellis/spec/frontend/index.md`
- `.trellis/spec/tauri/index.md`
- `.trellis/spec/guides/index.md`

Key rules:

- Components must not call `invoke` directly; use `src/services/*`.
- Keep pure workflow, parsing, and normalization logic outside React components.
- Validate untrusted JSON/text from IPC, files, plugins, MCP, terminal, Claude, and LLM output.
- Preserve Tauri capability and asset protocol boundaries.
- Add focused tests for parsers, workflow transitions, persistence adapters, and JSON migration logic.
- Do not grow `src/App.tsx` or `src-tauri/src/lib.rs` for feature-specific logic that can live in a module.

## Trellis Spec & Skills

Detailed coding rules and product context live under `.trellis/spec/`. Read the relevant index before changing code in that layer.

| Spec index | Scope |
|------------|-------|
| [`.trellis/spec/frontend/index.md`](.trellis/spec/frontend/index.md) | React 19, hooks, state, type safety, quality, directory structure |
| [`.trellis/spec/tauri/index.md`](.trellis/spec/tauri/index.md) | Tauri 2 IPC, security/filesystem, persistence and migrations |
| [`.trellis/spec/guides/index.md`](.trellis/spec/guides/index.md) | Cross-layer thinking, code reuse, commit hygiene, Trellis subagent prompts |

`.trellis/spec/guides/agent-harness-architecture.md` is the product constitution. Update it first when changing top-level layout, the `ViewMode` state machine, the Operator/Author/Inspector domain split, or the Trellis ↔ Mission double-write contract.

The Trellis workflow itself (phases, task creation, sub-agent dispatch) is documented in `.trellis/workflow.md`; load step detail on demand via `python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>`.

## UI System Policy

Ant Design is the default UI system for new controls, layout primitives, feedback, overlays, forms, tables, tabs, and icons. Semi UI is currently allowed only for the Claude composer `AIChatInput` integration in `src/components/ClaudeChatInput/`, where its Tiptap-based editing behavior is product-critical. Semi tokens must continue to bridge to Ant Design variables via `composer-semi-tokens.css`.

Do not add another UI framework.

## Commit Conventions

Use English Conventional Commits:

- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `docs: ...`
- `chore: ...`
- `test: ...`

Keep commits scoped by task and behavior. Do not include unrelated dirty worktree changes.
Use `.trellis/spec/guides/commit-hygiene.md` as the detailed local handoff policy.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **wise** (21132 symbols, 37599 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/wise/context` | Codebase overview, check index freshness |
| `gitnexus://repo/wise/clusters` | All functional areas |
| `gitnexus://repo/wise/processes` | All execution flows |
| `gitnexus://repo/wise/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
