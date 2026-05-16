# PRD: Trellis SDD Mode Detection and Switch (P3)

## Problem

P1 introduced the Trellis adapter; P2 added the filesystem bridge for `.trellis/tasks/<id>/`. There is no per-repository switch that controls whether Wise should drive its built-in Trellis flow, defer to a project-owned SDD installation, or turn SDD off entirely. Without this switch, the team-flow composer cannot distinguish a repository where Wise should write `.trellis/` artifacts from a repository where the user already manages those files via their own tooling.

## Scope

P3 adds the data model, persistence, detection, and a self-contained UI component for the SDD mode. P3 does NOT wire the component into the existing "associate repository" modal, the Repository settings modal, or the composer dispatch guard — that integration is P3b and follows after P3 ships.

### Discovery already done

- Repositories are JSON-backed (`~/.wise/repositories.json` via `load_repositories` / `save_repositories` in `src-tauri/src/app_state_commands.rs:235-262`), not SQLite tables. **No DB migration is needed.**
- `StoredRepository` (`src-tauri/src/app_state_commands.rs:18-38`) already uses `#[serde(default, ...)]` for backward-compatible field additions; the same pattern applies for the new field.
- The existing `update_repository_icon_display` command (`app_state_commands.rs:362`) is the shape to mimic for a new update command.
- Repository TypeScript type lives at `src/types.ts:4-18`.

### Rust side

- `src-tauri/src/app_state_commands.rs`:
  - `StoredRepository`: add `#[serde(default, skip_serializing_if = "Option::is_none")] sdd_mode: Option<String>`. Accepted persisted values: `"auto" | "wise_trellis" | "project_owned" | "off"`. The field is `Option<String>` so deserializing existing `~/.wise/repositories.json` files succeeds.
  - New `#[tauri::command] update_repository_sdd_mode(app, id, sdd_mode: Option<String>) -> Result<StoredRepository, String>`. Pattern matches `update_repository_icon_display`. Validates that `sdd_mode`, when `Some`, is one of the four allowed values; rejects others with `WF_INVALID_INPUT`.

- `src-tauri/src/trellis_bridge.rs`:
  - New `#[tauri::command] trellis_detect_sdd_signals(repo_path: String) -> Result<SddSignalsRow, String>`. Returns `{ hasTrellisTasks, hasTrellisSpec, hasOpenSpec, hasGenericSpec }` — booleans for `<repo>/.trellis/tasks/`, `<repo>/.trellis/spec/`, `<repo>/.openspec/`, `<repo>/.spec/`. Uses the same repo-path validation as the other bridge commands but does NOT require the directory to pre-exist for `.trellis/tasks/` — it just reports `false`.

- `src-tauri/src/lib_impl.rs`: extend `generate_handler!` with `update_repository_sdd_mode` and `trellis_bridge::trellis_detect_sdd_signals`.

### TypeScript side

- `src/types.ts`:
  - `Repository`: add `sddMode?: SddMode` (optional for back-compat with existing in-memory state).
  - New exported `SddMode` union: `"auto" | "wise_trellis" | "project_owned" | "off"`.

- `src/services/repository.ts`:
  - New `updateRepositorySddMode(id: number, mode: SddMode | null): Promise<Repository>`. Sending `null` clears the field (server stores `None`).

- `src/services/trellis/sddModeDetector.ts` (new):
  - `detectSddSignals(repoPath: string): Promise<SddSignals>` thin invoke wrapper around the new Rust command.
  - `resolveAutoSddMode(signals: SddSignals): SddMode` pure function with the precedence: `.trellis/tasks` or `.trellis/spec` → `project_owned`; `.openspec/` or `.spec/` → `project_owned`; otherwise → `wise_trellis`.
  - `effectiveSddMode(repository: Repository, signals: SddSignals): SddMode` pure function: returns the explicit `repository.sddMode` when it is not `undefined` and not `"auto"`; otherwise returns `resolveAutoSddMode(signals)`.

### UI

- `src/components/SddModeSwitch/index.tsx` (new): Ant Design `Segmented`-based switch with the four modes plus a small inline hint that explains the auto-resolved mode when `value === "auto"`. Props:
  ```ts
  interface Props {
    value: SddMode;
    autoResolved: SddMode;   // result of resolveAutoSddMode(signals)
    disabled?: boolean;
    onChange: (next: SddMode) => void;
    size?: "small" | "middle";
  }
  ```
  The component is presentational only; it does NOT call any service. The consuming parent owns the signals fetch and the persistence call. This keeps P3 unblocked from the integration-point UX choices that belong in P3b.
- `src/components/SddModeSwitch/index.css` (new, if needed): minimal styling, follow the existing Ant Design segmented patterns elsewhere in the app.

### Tests

- `src/services/trellis/sddModeDetector.test.ts` (new): bun:test coverage for `resolveAutoSddMode` (each signal combination → expected mode) and `effectiveSddMode` (auto-fallthrough + explicit override + undefined repo.sddMode).
- No bridge unit test for the new Rust command (matches the P2 stance of trusting the Tauri command boundary).
- Optional Rust inline test for the new repo update validation accepting/rejecting modes.

## Acceptance Criteria

- `bun test` passes (expected total ~70 with the new detector tests).
- `cargo check` clean inside `src-tauri/`.
- `cargo clippy --no-deps` produces no new warnings on touched files.
- `StoredRepository` deserialization remains backward compatible: a `~/.wise/repositories.json` file from before this change still loads (verified by inspection — the serde defaults guarantee it).
- `SddModeSwitch` renders without runtime errors in isolation (manual import in a scratch test file is acceptable; no Vitest UI harness exists in this repo).
- No edits to `src-tauri/src/wise_db.rs`. No edits to any UI component outside `src/components/SddModeSwitch/`. No edits to `App.tsx`, `AppImpl.tsx`, `omcAdapter.ts`, `trellisAdapter.ts`, `engine.ts`, `index.ts` (workflow). No DB migration.
- No edits to `lib.rs` if avoidable; the `trellis_bridge` module is already registered. Only `app_state_commands.rs`, `lib_impl.rs`, and the new `SddModeSwitch/` files for the frontend, plus type additions, should change.
- `trellis_bridge.rs` stays under 400 lines after the new command is added.

## Non-Goals

- No integration of `SddModeSwitch` into the "associate repository" modal (P3b).
- No integration into the Repository settings modal (P3b).
- No composer dispatch guard that refuses to dispatch a `trellis-team` template when `sddMode === "off"` (P3b).
- No automatic write of `prd.md` at workflow dispatch time (P4 path; depends on P3 + P2 mapping).
- No spec write-back to `.trellis/spec/<area>/index.md` (P4).
- No persistence migration — the field stays `Option` so existing JSON files load unchanged.

## Execution Notes

- Two-commit hygiene mirrors P2: (a) `feat(tauri): add SDD mode field, repository update command, and detection helper`, (b) `feat: add SddModeSwitch component, repository.sddMode type, and detector helpers`.
- Validate the persisted value against the four allowed strings on both the Rust side (in the update command) and the TS side (in the service wrapper, before invoke) to fail fast.
- The `SddModeSwitch` component should treat an undefined `repository.sddMode` as `"auto"` for display purposes. This keeps existing repositories rendering in a sensible default without writing the field eagerly.
- Verify the `Repository` type addition does not require updating any consumer file's TypeScript imports — `sddMode` is optional, so existing destructuring stays compile-clean.

## Out of Scope — Tracked for P3b

- Wire `SddModeSwitch` into:
  - the "associate repository" modal (creation flow),
  - the per-repository settings modal,
  - the composer dispatch guard for `trellis-team` template.
- Add a one-time backfill that auto-stamps `sddMode` for existing repositories using detector results (only if telemetry suggests users want it).
- Persist the auto-resolved value when the user explicitly picks "auto" so the rest of the app does not have to re-detect on every paint.

## Out of Scope — Tracked for P4

- `update-spec` stage writes back to `.trellis/spec/<area>/index.md`.
- Reverse-direction PRD parsing that turns a Trellis `prd.md` Acceptance Criteria section back into `WorkflowStageOutcomeCriterion[]` candidates for the graph editor.
