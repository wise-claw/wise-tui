# PRD: Architecture Split for Oversized App and Tauri Modules

## Problem

`src/App.tsx` is 5,194 lines and `src-tauri/src/lib.rs` is 9,835 lines. The files are doing too much: desktop shell coordination, feature orchestration, modal state, process/event wiring, Tauri command definitions, path helpers, persistence glue, plugin discovery, terminal/Claude execution, and workflow code are mixed together.

The goal is to reduce risk by extracting coherent modules while preserving behavior.

## Scope

### Frontend

Split `src/App.tsx` along existing product boundaries. The first pass should prioritize extraction, not redesign:

- App-shell state and layout coordination.
- Claude session orchestration and docks.
- Repository/project selection and persistence handoff.
- Workflow graph/runtime panels.
- PRD split panel wiring.
- Global shortcut/modals/drawers.

Use existing directories where they already exist, especially `src/components/`, `src/hooks/`, `src/services/`, and `src/constants/`.

### Tauri

Split `src-tauri/src/lib.rs` into domain modules matching current command clusters:

- `claude/` or `claude_code/` for Claude session, binary lookup, stream/session IO.
- `terminal/` for PTY and terminal commands.
- `git/` for repository/worktree/git operations.
- `commands/` or domain modules for project/repository/file commands.
- Keep `lib.rs` focused on app setup, state registration, command registration, and module wiring.

## Acceptance Criteria

- `src/App.tsx` no longer owns large feature-specific logic that can live in components/hooks/services.
- `src-tauri/src/lib.rs` no longer contains unrelated command clusters inline when a domain module can own them.
- No user-facing behavior changes are introduced intentionally.
- Existing service wrappers continue to work with the same command names unless a wrapper and Rust command are updated together.
- `bun test` passes.
- Rust code compiles under the normal Tauri build/type-check path when frontend build is allowed by the workflow owner.
- New module boundaries are reflected in `.trellis/spec/frontend/directory-structure.md` or `.trellis/spec/tauri/index.md` if the final pattern differs from current spec.

## Non-Goals

- Do not redesign the UI.
- Do not change persistence schema unless a compile-safe extraction requires a tiny helper move.
- Do not introduce a router or new state library.
- Do not rename public Tauri commands unless every frontend wrapper and caller is updated in the same task.

## Suggested Execution Notes

- Make several small commits rather than one giant refactor.
- Start with read-only extraction: move helpers and command clusters without changing logic.
- Prefer module-level tests only where extraction exposes pure logic.
- Keep `.gitignore` and lockfile policy out of this task.
