# Wise

Wise is a Tauri 2 desktop orchestration client for working with local code repositories and Claude Code workflows. It is no longer a starter desktop shell: the app coordinates repositories, Claude sessions, workflow graphs, PRD task splitting, terminal sessions, notifications, and persistent project state.

## Feature Matrix

| Area | What it does |
|------|--------------|
| Repository workspace | Tracks local repositories and projects in the left sidebar. |
| Claude sessions | Creates, restores, runs, cancels, and routes Claude Code sessions per repository. |
| Team workflow | Configures employees, workflow templates, graph-based workflow stages, task events, and acceptance verdicts. |
| PRD task split | Parses PRD/source material and materializes executable task snapshots. |
| Terminal and Git | Opens repository terminals, Git panels, diffs, history, branches, and worktrees. |
| MCP and skills | Displays Claude MCP, hooks, subagents, project skills, and local skills metadata. |
| Monitoring | Shows employee/team progress, background invocation details, and notification inbox state. |
| Multi-window desktop | Uses a main Tauri window plus a mascot window with shared app data. |

## Architecture

```text
React desktop shell
  src/App.tsx
  src/components/
  src/hooks/
        |
        v
Frontend service layer
  src/services/*
  src/services/workflow/*
        |
        v
Tauri IPC commands and events
  src-tauri/src/lib.rs
  src-tauri/src/*.rs
        |
        v
Local persistence and OS integration
  ~/.wise/wise.db
  ~/.wise/repositories.json
  ~/.wise/tabs.json
  local Claude/Git/terminal processes
```

Key files:

- `src/main.tsx`: main window React entry.
- `src/mascot.tsx`: mascot window React entry.
- `src/App.tsx`: desktop workspace shell and cross-panel coordination.
- `src/services/`: typed Tauri IPC wrappers and pure service logic.
- `src/services/workflow/`: workflow engine, replay, facade, event store, and adapters.
- `src/hooks/useClaudeSessions.ts`: Claude Code session and stream orchestration.
- `src-tauri/src/lib.rs`: Tauri app setup and command registration.
- `src-tauri/src/wise_db.rs`: SQLite setup and migrations.
- `src-tauri/src/wise_paths.rs`: `~/.wise` path and atomic file helpers.
- `src-tauri/src/repository_files.rs`: repository explorer/search/create/delete filesystem commands.
- `src-tauri/migrations/`: append-only SQLite migrations.
- `src-tauri/capabilities/default.json`: Tauri 2 capability allowlist.

## Storage

Wise stores durable app data under `~/.wise/`:

- `~/.wise/wise.db`: SQLite database for app settings, projects, workflows, task snapshots, messages, and mappings.
- `~/.wise/repositories.json`: legacy/current repository sidebar storage.
- `~/.wise/tabs.json`: legacy/current tab storage.
- `~/.wise/prd-images/` and `~/.wise/prd-runs/`: materialized PRD assets.

The asset protocol is intentionally scoped to `$HOME/.wise/**` in `src-tauri/tauri.conf.json`.

## Requirements

- Bun matching `package.json` `packageManager` (`bun@1.3.5`).
- Rust stable for Tauri commands and packaging.
- Platform prerequisites from the Tauri 2 documentation.

## Commands

```bash
bun install
bun test
bun run build
bun run tauri:build
```

Useful scripts:

- `bun test`: runs Bun tests under `src/**/*.test.ts`.
- `bun run build`: runs TypeScript check and Vite production build.
- `bun run tauri:dev`: starts Vite and opens the Tauri desktop window.
- `bun run tauri:build`: builds the desktop app bundle.
- `bun run tauri`: direct Tauri CLI access.

Agent note: project rules prohibit AI agents from running frontend dev/build/start/serve commands unless explicitly allowed. Agents should use code review, `bun test`, and targeted static checks by default.

## Package Manager Policy

Bun is the only supported JavaScript package manager for this repository. Keep `bun.lock` tracked. Do not commit `package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`.

## Development Guidelines

Project coding rules live in `.trellis/spec/`:

- `.trellis/spec/frontend/`: React, hooks, services, state, type safety, UI quality, and testing.
- `.trellis/spec/tauri/`: Tauri IPC, capabilities, filesystem security, persistence, and migrations.
- `.trellis/spec/guides/`: cross-layer and reuse thinking guides.

Before large changes, create or select a Trellis task under `.trellis/tasks/` and keep commits scoped to that task.

## Distribution

Manual/internal distribution can use the platform bundle under:

```text
src-tauri/target/release/bundle/
```

macOS builds distributed outside the App Store require Developer ID signing and notarization to avoid quarantine warnings. Windows builds need code signing to reduce SmartScreen warnings.

## Recommended IDE

VS Code with Tauri and rust-analyzer works well for the current stack.
