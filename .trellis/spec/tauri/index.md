# Tauri Development Guidelines

> Project-specific Tauri 2, Rust IPC, filesystem, and persistence conventions for Wise.

---

## Scope

Wise uses Tauri 2 as a desktop backend for the React frontend. The Rust side
owns OS integration, filesystem access, process execution, SQLite persistence,
window management, and event emission.

The active backend stack is:

- Tauri 2 commands and events.
- Rust modules under `src-tauri/src/`.
- SQLite through `rusqlite` in `src-tauri/src/wise_db.rs`.
- SQL migrations under `src-tauri/migrations/`.
- Tauri capability declarations in `src-tauri/capabilities/default.json`.
- App data under `~/.wise/`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [IPC Guidelines](./ipc-guidelines.md) | Command boundaries, events, DTOs, long-running work | Active |
| [Security and Filesystem](./security-and-filesystem.md) | Capabilities, asset scope, path validation, process safety | Active |
| [Persistence and Migrations](./persistence-and-migrations.md) | SQLite, JSON settings, migrations, atomic writes | Active |

---

## Cross-Layer Contract

Frontend components must not call Rust commands directly. The contract is:

```text
React component/hook
  -> src/services/<domain>.ts
  -> invoke("<tauri_command>", typed camelCase payload)
  -> #[tauri::command] Rust function
  -> Result<T, String>
```

DTO fields returned to TypeScript should be camelCase. Rust structs should use
Serde `rename_all = "camelCase"` where fields are serialized for the frontend.

---

## Pre-Development Checklist

Before editing Tauri code:

1. Read the matching frontend service wrapper.
2. Read nearby Rust commands for error style, path checks, and state access.
3. Check whether a helper already exists for `~/.wise`, repository roots,
   atomic writes, Claude binary lookup, or SQLite access.
4. Validate path boundaries before reading or writing user-controlled paths.
5. Decide whether the command is short-lived, long-running, or event-streaming.
6. Add a migration only when durable schema changes are required.

---

## Official Guidance Applied

Tauri 2 uses capabilities and permissions to expose APIs to windows, so Wise
keeps permissions explicit in `src-tauri/capabilities/default.json`. Tauri
commands are the frontend-to-Rust IPC boundary, and Tauri managed state should
be used for shared backend resources such as database handles or process
registries.

React guidance also matters at this boundary: frontend effects should
synchronize with these external Tauri systems, while pure derived state should
stay in render or services.

---

## Canonical Examples

App setup:

- `src-tauri/src/lib.rs` and `src-tauri/src/lib_impl.rs` for command registration and app setup only.
- `src-tauri/src/main.rs` as the process entry.

Persistence and paths:

- `src-tauri/src/wise_db.rs` for SQLite setup, migration include list, and shared DB state.
- `src-tauri/src/wise_paths.rs` for `~/.wise` paths and atomic file writes.
- `src-tauri/src/app_state_commands/` for settings, workflow graph, and workflow run command groups.

Repository and workspace filesystem:

- `src-tauri/src/repository_files.rs` for repository explorer/search/create/delete commands.
- `src-tauri/src/git_commands.rs` for git status, diff, and history commands.
- `src-tauri/src/project_workspace_paths.rs` and `src-tauri/src/workspace_commands.rs` for project workspace path resolution and commands.

PRD and split:

- `src-tauri/src/prd_materialize.rs` for path canonicalization and asset handling.
- `src-tauri/src/prd_url_fetch.rs` for PRD URL fetching commands.
- `src-tauri/src/claude_commands/prd_split.rs` and `src-tauri/src/claude_commands/prd_split_pipeline.rs` for PRD split execution and pipeline.

Mission and Trellis runtime:

- `src-tauri/src/mission_control.rs` for Mission persistence, runs, assignments, and evidence.
- `src-tauri/src/trellis_bootstrap.rs`, `src-tauri/src/trellis_runtime.rs`, `src-tauri/src/trellis_bridge.rs` for Trellis bootstrap, runtime events, and Mission bridging.

Workflow studio:

- `src-tauri/src/cc_workflow_studio.rs` and `src-tauri/src/cc_wf_studio_mcp_bridge.rs` for cc-workflow-studio integration and its MCP bridge.

Claude subsystem:

- `src-tauri/src/claude_commands.rs` and `src-tauri/src/claude_commands/` (attachments, disk_sessions, mcp, project_skills, subagents, terminal, shared) for Claude session commands.
- `src-tauri/src/claude_external_ingest.rs`, `src-tauri/src/claude_config_dir.rs`, `src-tauri/src/claude_code_usage.rs` for Claude config and usage surfaces.

Code knowledge graph:

- `src-tauri/src/code_knowledge_graph.rs` and `src-tauri/src/code_knowledge_graph/` (indexer, storage, search, language extractors, synthetic OpenAPI helpers).

Integrations:

- `src-tauri/src/dingtalk_enterprise_bot.rs` and `src-tauri/src/dingtalk_stream_gateway.rs` for DingTalk bot and gateway commands.
- `src-tauri/src/wise_push.rs` for push notifications.
- `src-tauri/src/cua_driver.rs` for CUA driver integration.

Skills, parsers, mascot:

- `src-tauri/src/skills_sh.rs` for command execution around project skills directories.
- `src-tauri/src/subagents_parser.rs` for subagent metadata parsing.
- `src-tauri/src/system_resource.rs` for system resource probes.
- `src-tauri/src/wise_mascot.rs` for mascot window state.

Frontend service wrappers:

- `src/services/claude.ts` and `src/services/repository.ts` for the front-of-IPC contract.
- `src-tauri/src/agent_registry.rs` is the reference for process-wide singleton state via `tauri::State`, cached OS probes with `RwLock`, and short-lived `tokio::process::Command` detection exposed through typed Tauri commands.
- `src-tauri/src/extensions/` is the reference for a JSON manifest contract (`wise-extension.json`), a topo-sorted registry with atomic hot-reload (inner-state swap), forked subprocess lifecycle hooks with per-kind timeouts, and persisted enable state via atomic temp+rename writes under `~/.wise/extension-states.json`.
- `src-tauri/src/skills/` is the reference for the three-tier skill source model (`builtin | custom | extension`): a path-based classifier, an external-path scanner over `~/.claude/skills`, `~/.codex/skills`, etc., copy and symlink import flows under `~/.wise/skills/`, and a SQLite-persisted user-added external paths table. Existing `claude_commands::project_skills` outputs are extended additively with `source` and `is_symlink` fields without changing call sites.
- `src-tauri/src/mcp/` is the reference for backend-neutral MCP plumbing: a tagged `McpTransport` union over stdio / sse / http / streamable_http, an `McpProtocol` async trait every engine can implement, an `McpSource` enum (`user`, `builtin`, `extension:<name>`) with stable wire format, and a SQLite-persisted `mcp_server` table keyed by `(name, source)` with upsert semantics. Existing `claude_commands::mcp` is left untouched; the new layer is additive and consumed via separate Tauri commands.
- `src/components/HubCard/` is the shared visual primitive set for settings hub panels (Extensions, MCP, Skills, Agents). Pulls colour/border/radius from AntD CSS variables. New panels compose `HubCard` + `HubItems` + `HubItem` + `HubTag` + `HubDot`; they live next to the corresponding service in `src/services/` and mount inside the Author-domain configuration center. `AppSettingsModal` is legacy compatibility for extension settings, not the canonical builtin settings surface.

Productization rule:

- Wise can change frontend and Tauri code to support the AionUi-inspired workbench direction: Hub marketplace, platform-neutral Channels, scheduled Automation, Artifact review, Team Mode, and runtime environment control.
- Existing backend capabilities must not be deleted for UI cleanup. Keep commands, migrations, persisted data, and integration paths intact; expose them through clearer wrappers, aggregation commands, or migrated presentation layers.
- Avoid adding single-platform Tauri modules as top-level product concepts. Platform-specific backends such as DingTalk should be consumed by a neutral Channel layer when they reach the UI.
- Backend code may add aggregation or adapter commands for a cleaner
  configuration-center menu, but do not delete existing commands, migrations,
  persisted data, or integration paths merely because the frontend entry moves.
