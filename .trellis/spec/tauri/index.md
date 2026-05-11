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

- `src-tauri/src/lib.rs` for command registration and app setup only.
- `src-tauri/src/wise_db.rs` for SQLite setup, migrations, and shared DB state.
- `src-tauri/src/wise_paths.rs` for `~/.wise` paths and atomic file writes.
- `src-tauri/src/repository_files.rs` for repository explorer/search/create/delete filesystem commands.
- `src-tauri/src/prd_materialize.rs` for path canonicalization and asset handling.
- `src-tauri/src/skills_sh.rs` for command execution around project directories.
- `src/services/claude.ts` and `src/services/repository.ts` for frontend command wrappers.
