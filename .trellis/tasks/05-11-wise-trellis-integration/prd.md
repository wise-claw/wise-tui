# PRD: Trellis SDD Integration — PoC Minimum Path

## Problem

Wise already has the workflow engineering harness (Stage / Gate / Event store / Replay / Router / Adapter at `src/services/workflow/`), `WorkflowTemplate` graph editor, `EmployeeItem` agent roles, and an `OmcWorkflowAdapter` that dispatches to Claude Code via OMC slash commands. It does not have a spec-driven development (SDD) lifecycle around tasks — no PRD-before-implement, no spec-after-check.

Trellis is the natural fit. The PoC must prove a Trellis adapter can run in parallel with the OMC adapter without touching the main engine model, the database schema, the UI, or Rust.

## Scope — PoC Minimum

Build the smallest end-to-end path where a workflow task with `templateId === "trellis"` is dispatched to a Trellis-style adapter that executes the `implement` and `check` stages by invoking the existing Trellis sub-agents (`trellis-implement`, `trellis-check`) via Claude Code.

Files to add:

- `src/services/workflow/trellisAdapter.ts` — `TrellisWorkflowAdapter implements OmcWorkflowAdapter`. Maps the routed `templateId === "trellis"` plus a stage hint to a Trellis sub-agent invocation. For PoC, support two stages:
  - `implement` → spawn `trellis-implement` sub-agent (no slash command, direct prompt) on a worktree-isolated copy.
  - `check` → spawn `trellis-check` sub-agent.
  - Other stages fall back to a generic Claude Code invocation that runs `/trellis:continue` so the existing Trellis main-session flow handles them.
  - Reuse `gitWorktreeAddOmcBatch` for worktree isolation, and reuse `executeClaudeCodeAndWait` for invocation.
  - Emit artifacts under `trellis://task/<taskId>/<stage>/attempt-<n>` plus the existing `repo://` ref. Do not parse stdout — classify by `invocation.success` only, same shape as `ClaudeOmcWorkflowAdapter`.

- `src/services/workflow/adapterRegistry.ts` — Tiny resolver: given a routed `templateId`, return the right adapter instance. Default registry contains `claude-omc` (existing `ClaudeOmcWorkflowAdapter`) and `trellis`. No DI framework, no class hierarchy beyond what already exists.

- `src/services/workflow/trellisDefaults.ts` — Pure function returning the in-code default `WorkflowTemplateItem` for `trellis-team`. Stages: `brainstorm → research → plan → implement → check → update-spec → finish`. Each stage carries a default `assignees[]` with one entry of `requiredCount: 1, isRequired: true` keyed to a placeholder agentType so the template can be selected in the composer without breaking validation. The template is built in memory; no persistence in PoC.

Files to modify (minimum touch):

- `src/services/workflow/engine.ts`
  - `gatePlanForTemplate` (`engine.ts:32-44`): add `case "trellis": return ["test", "review"];`
  - `executeTask` (`engine.ts:212-343`): after `routed = ...`, resolve `adapter = registry.resolve(routed.templateId)`. Replace the hard-coded `this.omcAdapter.execute(...)` with `adapter.execute(...)`. Keep `this.omcAdapter` constructor field as the default for the registry fallback so call sites that build the engine directly with one adapter (tests) keep working.
  - Constructor: accept an optional `AdapterRegistry`. When absent, build the default registry from the provided `omcAdapter`.

- `src/services/workflow/index.ts` — Export the new registry and adapter so the host (`AppImpl` / wherever the engine is wired) can compose them.

Files explicitly not touched in PoC: `src-tauri/src/wise_db.rs`, any `*.rs`, any UI component, `Repository` type, the `STAGE_ORDER` constant in `engine.ts:30`, the existing `omcAdapter.ts`.

## Acceptance Criteria

- `bun test` passes, including any new focused tests added for `adapterRegistry` and `trellisAdapter` shape.
- A focused unit test (`trellisAdapter.test.ts`) verifies: given `templateId === "trellis"` and a stub Claude invocation that returns success, the adapter returns `status: "succeeded"`, emits a `trellis://` artifact ref, includes a `repo://` artifact ref, and produces at least one `progressSignals` entry referencing the stage.
- A focused unit test (`adapterRegistry.test.ts`) verifies: `resolve("trellis")` returns the Trellis adapter; `resolve("autopilot")` and any unknown id return the OMC adapter (default fallback).
- `engine.test.ts` continues to pass without modification. If the engine constructor signature changes, the test file may receive a one-line update to pass the registry — that is allowed.
- No new public Tauri command is added. No DB migration is added. No file under `src-tauri/src/` is modified.
- No edits to `src/App.tsx`, `src/AppImpl.tsx`, `src-tauri/src/lib.rs`, or `src-tauri/src/lib_impl.rs`.

## Non-Goals (PoC)

- No `Repository.sddMode` field, no auto-detection of `.trellis/` in user repos.
- No `.trellis/tasks/<id>/` bidirectional bridge (P2).
- No UI surface for selecting `trellis-team`. The composer can still pick it because templates are loaded from defaults plus DB, and the in-memory default is enough for unit tests. End-to-end composer wiring is P3.
- No spec write-back during `update-spec` (P4).
- No Tauri command additions.
- No `STAGE_ORDER` change in `engine.ts:30`.
- No edits to `omcAdapter.ts` beyond the registry plumbing in `engine.ts`.

## Execution Notes

- Keep the adapter file under 200 lines. The OMC adapter is the reference shape — copy its structure (`startedAt`, `gitWorktreeAddOmcBatch`, `executeClaudeCodeAndWait`, artifact ref dedup) and trim what is OMC-specific (no `extractOmcResult`, no transcript scan).
- Stage hint sourcing: for PoC the `TaskRouter` does not yet emit stage. Use the `subagentType` field passed to `OmcWorkflowAdapter.execute` as the stage hint. Accept values `"trellis-implement"`, `"trellis-check"`, anything else → fallback to `/trellis:continue` slash command.
- Prompt shape for sub-agent stages: do not invent a slash command. Construct a plain prompt that names the active task path and the goal. The Trellis hook system will inject task context at SessionStart on the spawned Claude Code child. Active task path is read from `task.py current` output before dispatch — but in PoC keep it simple: pass the task path through an explicit input field if available, otherwise omit (the Trellis hook does the heavy lifting).
- Tests use the same Vitest layout as `engine.test.ts` and `acceptanceVerdict.test.ts`. Stub `executeClaudeCodeAndWait` and `gitWorktreeAddOmcBatch` with module-level mocks.
- Commit hygiene: split into two commits — (a) registry + adapter + defaults + tests, (b) engine wire-through. Each must keep `bun test` green.
- The host that wires `ClaudeOmcWorkflowAdapter` into the engine today is the place to also inject the registry. Find it via grep before editing; do not modify `AppImpl` if a simpler injection site exists (e.g. wherever `new DefaultWorkflowEngine(...)` is called).

## Out of Scope — Tracked for Later Phases

- P2: `.trellis/tasks/<id>/` bidirectional bridge + Rust commands `trellis_read_task`, `trellis_write_prd`, `trellis_list_tasks`.
- P3: `Repository.sddMode` (auto / wise_trellis / project_owned / off) with detection on repo add.
- P4: `update-spec` stage writes back to `.trellis/spec/<area>/index.md` and reads spec to generate `stageSuccessCriteria` candidates.
