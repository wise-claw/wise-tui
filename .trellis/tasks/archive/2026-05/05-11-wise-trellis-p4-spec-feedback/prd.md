# PRD: Trellis Spec Write-Back and Reverse Parsing (P4)

## Problem

P1 connected the engine to a Trellis adapter; P2 added the filesystem bridge for `.trellis/tasks/<id>/`; P3 added the SDD mode field, detection signals, and a stand-alone switch component. None of this yet closes the loop between the workflow editor's `stageSuccessCriteria` and the repository's `.trellis/spec/<area>/index.md`. Today, criteria authored in the graph canvas live only in the workflow's database; the project-level spec index documents are owned manually. P4 makes the round-trip possible at the data layer, without yet wiring it into the engine's `update-spec` stage or the UI (those land in a P4b that we are not scoping in this PRD).

## Scope

### Discovery already done

- `.trellis/spec/` is organized one directory deep per area: `frontend/`, `tauri/`, `guides/`, each with an `index.md` plus topic files. Reference: `.trellis/spec/frontend/index.md`, `.trellis/spec/tauri/index.md`, `.trellis/spec/guides/index.md`.
- P2 already exposes `wise_paths::write_file_atomic` style writes within `trellis_bridge.rs`. The same path-sandbox helpers used for `.trellis/tasks/` apply for `.trellis/spec/` with a different root.
- `WorkflowStageOutcomeCriterion` lives at `src/types.ts` and the renderer that turns it into markdown lives at `src/services/trellisTaskMapping.ts:36-44` (added in P2).

### Rust bridge — extend `src-tauri/src/trellis_bridge.rs`

Add three commands and a small shared helper, all path-sandboxed under `<repo>/.trellis/spec/`:

- `trellis_list_spec_areas(repo_path: String) -> Result<Vec<TrellisSpecAreaRow>, String>`
  - Walks `<repo>/.trellis/spec/` one level deep.
  - Returns `{ area, hasIndex, mdFileCount }`.
  - `area` is the directory name; rejected if it does not match `^[A-Za-z0-9_.-]+$`.

- `trellis_read_spec_index(repo_path: String, area: String) -> Result<TrellisSpecIndexRow, String>`
  - Returns `{ area, content: String, sizeBytes: u64 }`.
  - `content` is the raw `index.md`, capped at 256 KB (truncation marker identical to P2's prd-md truncation).
  - Returns an empty content with `sizeBytes: 0` if `index.md` does not exist; does not error.

- `trellis_write_spec_index(repo_path: String, area: String, content: String) -> Result<(), String>`
  - Refuses content > 256 KB.
  - Creates `<repo>/.trellis/spec/<area>/` if it does not exist (mirroring how the human-curated structure looks; lower friction than refusing).
  - Atomic write via the local helper introduced in P2.

Shared helper:

- A private `canon_trellis_spec_root(repo_path) -> Result<PathBuf, String>` mirroring `canon_trellis_tasks_root` but rooted at `.trellis/spec/`. Required because `.trellis/spec/` may not always exist; the helper creates it on first write if absent. List/read do NOT create the directory; only write does.

- Reuse the same `validate_task_id` regex for `area`, renaming the call site to read better but keeping a single regex pass (a new `validate_simple_slug` private helper that `validate_task_id` then delegates to).

### TS wrappers — `src/services/trellisSpecBridge.ts` (new)

- Mirrors the shape of `trellisTaskBridge.ts`. Five exported items:
  - `TrellisSpecArea` interface
  - `TrellisSpecIndex` interface
  - `listTrellisSpecAreas(repoPath)` invoke wrapper
  - `readTrellisSpecIndex(repoPath, area)` invoke wrapper
  - `writeTrellisSpecIndex(repoPath, area, content)` invoke wrapper

### Mapping — extend `src/services/trellisTaskMapping.ts`

Add two pure functions, keep the existing exports unchanged:

- `criteriaToSpecMarkdownSection(area: string, criteria: WorkflowStageOutcomeCriterion[]): string`
  - Produces a deterministic block ready to embed in an `index.md`:
    ```
    <!-- wise:stage-criteria area="frontend" begin -->
    ## Wise Stage Criteria — frontend

    - **<name>** — <requirement>
    ...

    <!-- wise:stage-criteria area="frontend" end -->
    ```
  - Names and requirements are trimmed; empty ones substitute `(unnamed)` / `(no requirement)` as P2 does.

- `parseAcceptanceCriteriaSection(markdown: string): WorkflowStageOutcomeCriterion[]`
  - Scans a Trellis-style `prd.md` (the kind P2's forward serializer produces) and extracts the `## Acceptance Criteria` list.
  - Recognizes the exact line format `- **<name>** — <requirement>` (with an em dash) and the looser `- <name>: <requirement>` (colon, regular hyphen) as a fallback.
  - Stops at the next `## ` heading or end of input.
  - Returns an empty array if no `## Acceptance Criteria` heading is present.

- `mergeSpecMarkdownWithStageCriteria(existing: string, area: string, criteria: WorkflowStageOutcomeCriterion[]): string`
  - If the existing markdown contains a matching marker block, replace it.
  - If not, append a blank line plus the new block.
  - Otherwise unchanged.
  - Returns the merged markdown; the caller decides whether to `writeTrellisSpecIndex`.

### Tests

- `src/services/trellisTaskMapping.test.ts`: add cases for the three new functions:
  - `criteriaToSpecMarkdownSection` produces the expected marker-fenced block; empty criteria still produces a header with `(no entries)` placeholder.
  - `parseAcceptanceCriteriaSection` recognizes both `- **X** — Y` and `- X: Y` shapes, stops at the next `## `, ignores leading whitespace, and returns `[]` when the section is absent.
  - `mergeSpecMarkdownWithStageCriteria` replaces an existing block in-place; appends when absent; preserves trailing newlines.

- No bridge unit tests for the new Rust commands (same boundary-trust stance as P2/P3).

## Acceptance Criteria

- `bun test` passes (expected ~70-75 with the new mapping cases).
- `cargo check` clean inside `src-tauri/`.
- `cargo clippy --no-deps`: no new warnings on touched files.
- All new code lives in: extensions to `src-tauri/src/trellis_bridge.rs`, the existing `src/services/trellisTaskMapping.ts`, the new `src/services/trellisSpecBridge.ts`, and additional test cases.
- No edits to `wise_db.rs`, `app_state_commands.rs`, `App.tsx`, `AppImpl.tsx`, `lib.rs`, `engine.ts`, `trellisAdapter.ts`, `omcAdapter.ts`, `workflow/index.ts`. No DB migration.
- `trellis_bridge.rs` after the additions stays under 500 lines.
- The Trellis adapter's behavior is unchanged in P4: no auto-write of spec at stage transitions. That is P4b.

## Non-Goals

- No automatic invocation of `writeTrellisSpecIndex` from the workflow engine, the Trellis adapter, or the `update-spec` stage. That is P4b.
- No UI surface in the graph canvas for "import criteria from spec" or "publish criteria to spec". That is P4b.
- No bidirectional sync state machine; the round-trip is composable via the three new functions but the caller drives ordering.
- No multi-file spec layout support. The functions target `index.md` only; topic files (`hook-guidelines.md` etc.) are left alone.
- No semantic markdown parser dependency. Parsing is line-oriented; complex prose paragraphs are not recovered, only the discrete `- **X** — Y` list items.

## Execution Notes

- For `parseAcceptanceCriteriaSection`, the em dash is `U+2014`. Use the literal character in the source; do not rely on a regex unicode class.
- For `mergeSpecMarkdownWithStageCriteria`, the marker comment is the only thing identifying the block. Match on the begin marker substring with the area attribute included, so two different areas' blocks coexist if a caller ever writes both.
- Two-commit hygiene: (a) `feat(tauri): expand trellis_bridge with spec index commands`, (b) `feat: add trellisSpecBridge and spec-mapping helpers`.
- The third commit will be `chore: plan Trellis spec write-back and reverse parsing (P4)` for the task metadata.

## Out of Scope — Tracked for P4b

- `update-spec` stage in `trellisAdapter.ts` calls `writeTrellisSpecIndex` after a successful spec stage.
- Graph canvas exposes an "import from spec" action that calls `readTrellisSpecIndex` + `parseAcceptanceCriteriaSection`.
- Telemetry counters for spec write-back frequency.
