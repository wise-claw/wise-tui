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

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **wise** (19129 symbols, 33468 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
