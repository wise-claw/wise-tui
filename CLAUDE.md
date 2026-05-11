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

## Architecture

### Frontend

- `src/App.tsx`: desktop workspace shell and app-wide coordination.
- `src/components/`: feature and shared UI surfaces.
- `src/hooks/`: reusable stateful orchestration.
- `src/services/`: Tauri IPC wrappers and pure service modules.
- `src/services/workflow/`: workflow engine, facade, replay, event store, and adapters.
- `src/utils/`: pure helpers.
- `src/types.ts` and `src/types/`: shared and domain types.

There is no route-based `src/pages/` architecture. Do not add `pages/` unless real routing is introduced.

### Tauri Backend

- `src-tauri/src/main.rs`: entry point.
- `src-tauri/src/lib.rs`: app setup and command registration.
- `src-tauri/src/wise_db.rs`: SQLite setup and migrations.
- `src-tauri/src/wise_paths.rs`: `~/.wise` path and atomic file helpers.
- `src-tauri/src/repository_files.rs`: repository explorer/search/create/delete filesystem commands.
- `src-tauri/src/*.rs`: domain modules for push, mascot, PRD materialization, Claude usage, CUA, DingTalk, skills, and parsers.
- `src-tauri/capabilities/default.json`: explicit Tauri 2 permissions.
- `src-tauri/tauri.conf.json`: windows, bundle config, asset protocol scope.

## Storage

Application-owned durable data lives under `~/.wise/`:

- `wise.db`
- `repositories.json`
- `tabs.json`
- `prd-images/`
- `prd-runs/`

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
