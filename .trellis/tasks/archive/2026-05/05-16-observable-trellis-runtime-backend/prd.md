# Observable Trellis Runtime Backend

## Goal

Make Trellis observable inside Wise as a backend runtime, not just a set of files and platform hooks. When a user opens a Wise project, the backend must expose the Trellis workflow, task lifecycle, hook activity, agent ownership, spec history, onboarding state, replay timeline, and workspace diffs as structured APIs that the frontend can visualize later.

## Requirements

- Add a durable Trellis runtime event ledger that is project-aware, session-aware, task-aware, and queryable by event kind.
- Compile `.trellis/workflow.md` into a structured model of phases, steps, workflow-state blocks, platform blocks, and validation issues.
- Expose task lifecycle execution through the backend by running `.trellis/scripts/task.py` commands instead of only mutating `task.json`.
- Track project-level agent ownership independently from PRD Mission runs, including repository, task, session, status, heartbeat, and current file.
- Version spec/workflow edits so Wise can show history and later support rollback/diff.
- Produce onboarding state for a selected project: init status, developer identity, hooks, workflow, spec, task, context, and runtime ledger readiness.
- Produce a full-chain replay that merges runtime events, agent runs, and spec revisions into a single timeline.
- Capture and diff Trellis workspace snapshots for `.trellis/` files and platform integration files.

## Acceptance Criteria

- [x] SQLite migrations create durable tables for runtime events, agent runs, spec revisions, and workspace snapshots.
- [x] Rust Tauri commands cover all eight backend capabilities without adding frontend UI.
- [x] TypeScript service wrapper exposes typed camelCase contracts; React components do not call new commands directly.
- [x] Workflow compiler rejects missing project roots safely and reports missing/invalid workflow artifacts as structured validation issues.
- [x] Task lifecycle API validates project paths and records command result events with stdout/stderr summaries and exit codes.
- [x] Snapshot diff reports added, removed, modified, and unchanged files without reading outside the project/platform integration scope.
- [x] Tests cover migration registration, workflow compilation, snapshot diffing, service command wrappers, and a minimal runtime event round trip.

## Non-Goals

- No frontend panels in this task.
- No real-time hook rewiring in platform scripts yet; this backend accepts and stores hook/runtime events so hooks can be wired later.
- No long-running agent process manager replacement; this adds the observable ownership model that existing dispatch flows can report into.
