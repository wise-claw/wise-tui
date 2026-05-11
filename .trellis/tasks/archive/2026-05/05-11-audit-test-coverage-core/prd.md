# PRD: Raise Regression Coverage for Workflow and Persistence Core

## Problem

The project has only 12 Bun tests across 2 files while the codebase contains critical workflow, parsing, process-stream, and SQLite persistence logic. The audit finding described this as near-zero coverage for roughly 270k lines of code.

The first coverage pass should protect the highest-risk pure logic and persistence contracts, not chase line coverage numbers.

## Scope

Add focused tests for:

- `src/services/workflowGraphRuntime.ts`: graph/runtime transformations and edge cases.
- `src/services/splitPolicyRouter.ts`: policy routing decisions and fallbacks.
- `src/services/claudeStreamParser.ts`: stream chunk parsing, malformed input, and boundary conditions.
- `src-tauri/src/wise_db.rs`: migration ordering, schema availability, and persistence invariants where practical.
- Any helper extracted from `wise_db.rs` to make migration registration testable.

## Acceptance Criteria

- New tests cover at least the four named risk areas or document why one cannot be tested without a follow-up harness.
- `bun test` passes.
- Rust-side tests or check commands are added for `wise_db.rs` if the current Rust test harness can run without launching the desktop app.
- Tests include malformed/legacy input cases, not only happy paths.
- No production logic is weakened just to make tests pass.

## Non-Goals

- Do not attempt broad snapshot testing of React UI.
- Do not start frontend dev/build/start/serve commands.
- Do not add a new JS test framework while Bun tests are sufficient.
- Do not use real user `~/.wise` data in tests.

## Suggested Verification

```bash
bun test
```

Use a temporary database/file location for Rust persistence tests.
