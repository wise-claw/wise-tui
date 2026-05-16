# Implementation Plan

## Scope

Implement the backend contracts for the eight Trellis runtime capabilities. Do not add frontend panels.

## Steps

1. Add SQLite migration `022_trellis_runtime.sql` with runtime events, agent runs, spec revisions, and workspace snapshots.
2. Register migration `022_trellis_runtime` in `src-tauri/src/wise_db.rs` and update migration tests.
3. Add `src-tauri/src/trellis_runtime.rs` with path validation, workflow parser, lifecycle runner, agent graph, spec history, replay, snapshot, and diff helpers.
4. Register the module in `src-tauri/src/lib.rs` and commands in `src-tauri/src/lib_impl.rs`.
5. Add `src/services/trellisRuntime.ts` as the only TypeScript wrapper for the new commands.
6. Add `src/services/trellisRuntime.test.ts` to verify wrapper payload contracts.
7. Add Rust unit tests for workflow compilation, snapshot diffing, and migration table creation.
8. Run targeted Rust tests, `bun test`, and `bun run build` or `tsc` where practical.

## Verification Commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bun test
bun run build
```

## Review Checklist

- Runtime events are durable and queryable.
- Workflow compiler returns structured phases/steps/state blocks.
- Task lifecycle uses `task.py`, not direct JSON mutation.
- Agent ownership graph is project-level and not Mission-only.
- Spec revisions and workspace snapshots are persisted.
- Replay merges event, agent, and revision timelines.
- TypeScript wrapper hides direct `invoke` usage from UI code.
