# PRD: Trellis Task Directory Bridge (P2)

## Problem

The Trellis adapter (P1) connects the workflow engine to Trellis sub-agents over `templateId`, but the engine's task model (`WorkflowTaskItem`) has no link to the on-disk Trellis task directory (`.trellis/tasks/<id>/`). As a result:

- Tasks produced by a team workflow leave no `prd.md` / `status` for Trellis sub-agents to consume.
- Trellis tasks already in a repository cannot be listed or surfaced by Wise.
- The SDD round-trip (PRD → implement → status update → spec reference) has no fact source.

P2 adds the minimum filesystem-bridge primitives so later phases (P3 SDD mode switch, P4 spec write-back) can plug in without re-touching Rust.

## Scope

### Rust bridge — `src-tauri/src/trellis_bridge.rs` (new)

Five `#[tauri::command]` functions, all path-sandboxed under `<repoPath>/.trellis/tasks/`:

- `trellis_list_tasks(repo_path: String) -> Result<Vec<TrellisTaskSummaryRow>, String>`
  - Walks `<repo>/.trellis/tasks/` one level deep (skips `archive/`).
  - For each child dir, reads `task.json` (best-effort) and emits `{ taskId, dir, title, status, hasPrd, hasResearch, createdAt, parent }`.
  - Tolerates missing/invalid `task.json`: emits an entry with `title=dir, status="unknown"`.

- `trellis_read_task(repo_path: String, task_id: String) -> Result<TrellisTaskDetailRow, String>`
  - Returns `{ taskId, dir, title, status, taskJsonRaw, prdMarkdown (max 256 KB), researchFiles: Vec<String> }`.
  - `prdMarkdown` capped at 256 KB; if larger, truncate and append a marker line.

- `trellis_write_prd(repo_path: String, task_id: String, content: String) -> Result<(), String>`
  - Refuses content > 256 KB.
  - Refuses if `<repo>/.trellis/tasks/<task_id>/` does not already exist (no task creation; trellis CLI owns that).
  - Atomic write via existing `wise_paths::write_file_atomic`.

- `trellis_write_status(repo_path: String, task_id: String, status: String) -> Result<(), String>`
  - Accepted values: `planning | in_progress | completed | rejected | archived`. Any other value rejected with `WF_INVALID_INPUT`.
  - Reads existing `task.json`, mutates only the `status` field (preserves whitespace/key order using `serde_json::Value` round-trip), atomic-writes back.

- `trellis_list_research(repo_path: String, task_id: String) -> Result<Vec<TrellisResearchFileRow>, String>`
  - Lists immediate files in `<repo>/.trellis/tasks/<task_id>/research/` (does not recurse).
  - Each row: `{ name, sizeBytes, modifiedAt }`. Returns empty vec if dir missing.

Shared constraints:

- `task_id` is validated by a single private helper: must match `^[A-Za-z0-9_.-]+$` and contain no `..` segment. Reject otherwise with `WF_INVALID_INPUT`.
- Path canonicalization: build the target path, canonicalize, then assert it starts with `canon(<repo>/.trellis/tasks/)`. Borrow the pattern from `repository_files.rs:154 assert_resolved_path_under_repo` but inlined (do not export it across modules in P2).
- `repo_path` validation: reject if it is empty or relative; canonicalize and refuse if `<repo>/.trellis/tasks/` does not exist.
- No DB writes. No state shared with `wise_db.rs`.
- All public types implement `Serialize` and use camelCase field names so the TS layer can consume them directly.

### Command registration — `src-tauri/src/lib_impl.rs`

Single edit: extend the `tauri::generate_handler!` macro at line 82 to include the five new commands, behind a `use crate::trellis_bridge::*;` import.

### TS wrappers — `src/services/trellisTaskBridge.ts` (new)

Thin invoke wrappers, one function per Rust command, matching field names. No business logic in this file. Types are exported from the same module.

### Mapping — `src/services/trellisTaskMapping.ts` (new)

Two pure functions:

- `workflowTaskToTrellisDraft(task: WorkflowTaskItem, graph?: WorkflowGraph): { prdMarkdown: string; statusForTrellis: string }`
  - Builds a deterministic markdown body from `task.title`, `task.content`, and the `stageSuccessCriteria` of the graph node currently assigned (best-effort lookup).
  - Maps `WorkflowTaskItem.status` to a Trellis status: `in_progress → in_progress`, `completed → completed`, `rejected → rejected`, `archived → archived`.

- `trellisTaskToWorkflowStatus(detail: TrellisTaskDetail): WorkflowTaskItem["status"] | null`
  - Inverse of the status map; unknown values return `null` so callers can decide.

No bidirectional PRD parser in P2 — only forward serialization. Reading back from PRD into stageSuccessCriteria is P4. The mapping file stays under 120 lines.

### Tests

- `src/services/trellisTaskMapping.test.ts` — pure-function coverage for both directions and edge cases (empty criteria, unknown status, missing graph).
- No bridge unit test (would need invoke mock); skipped intentionally per `engine.test.ts:55-71` pattern of trusting Tauri command boundary.

## Acceptance Criteria

- `bun test` passes (50 → 50 + new mapping tests, expect ~55-60).
- `cargo check` clean in `src-tauri/` after the edits.
- `cargo clippy --no-deps --message-format=short -- -D warnings` either clean on touched files or only flags pre-existing issues; new files must be clippy-clean under `-W clippy::pedantic` is NOT required, default lints only.
- Five new commands registered in `lib_impl.rs` `generate_handler!`.
- No modification to `wise_db.rs`, `App.tsx`, `AppImpl.tsx`, `lib.rs`, `capabilities/default.json` (this last one only if no permission is required — verify; if any new permission is needed, adding it is allowed but call it out explicitly in the commit).
- No modification to `omcAdapter.ts`, `trellisAdapter.ts`, `engine.ts`, `index.ts`, or anything in `src/components/`.
- `trellis_bridge.rs` <= 350 lines. Each new TS file <= 250 lines.
- Path safety verified: an absolute path attack, `..` traversal, or symlink escape on `task_id` returns `WF_INVALID_INPUT` or an OS error — there must be a test in mapping or an inline assertion comment if Rust-side tests are not added (Rust unit tests inside the module are welcome but optional in P2).

## Non-Goals

- No UI surface for browsing or editing Trellis tasks (deferred to P3 alongside SDD mode switch).
- No automatic PRD write at workflow dispatch time (deferred to P3, gated by `sddMode`).
- No bidirectional PRD parsing back into stageSuccessCriteria (P4).
- No wrapping of `task.py` CLI — the Python CLI continues to own create / start / finish / archive.
- No new DB column, no new migration.
- No spec write-back to `.trellis/spec/<area>/index.md` (P4).
- No changes to capability permissions unless the Tauri runtime explicitly errors; in that case the smallest possible scope is added.

## Execution Notes

- Reuse `wise_paths::write_file_atomic` (`src-tauri/src/wise_paths.rs:22`) for both `trellis_write_prd` and `trellis_write_status`.
- Use `serde_json::Value` for `task.json` round-trip mutation to preserve unknown fields. Do not deserialize into a typed struct and re-serialize — the trellis CLI may add fields between Wise sessions.
- Run `cargo check` after Rust edits, `cargo clippy --no-deps` on touched files, and `bun test` after TS edits. Report each result.
- Two-commit hygiene: (a) `feat(tauri): add trellis_bridge filesystem commands` for the Rust + lib_impl wiring, (b) `feat: add trellisTaskBridge and mapping for WorkflowTaskItem` for the TS layer + tests. Both must independently pass their toolchain checks.
- Verify the running binary does not need a fresh capability entry: the new commands are plain `#[tauri::command]` and registered in `generate_handler!`; Tauri 2 capabilities only gate filesystem plugin operations, not custom commands. If `cargo check` succeeds and the team runs the existing test path without runtime permission errors in the CI script (TBD), the capability file does not need editing.

## Out of Scope — Tracked for Later

- P3 `Repository.sddMode` (auto / wise_trellis / project_owned / off) with detection on repo add.
- P3 UI: `SddModeSwitch`, Repository settings modal entry, composer dispatch guard.
- P4 `update-spec` stage writes `.trellis/spec/<area>/index.md`; reverse read populates stageSuccessCriteria candidates.
