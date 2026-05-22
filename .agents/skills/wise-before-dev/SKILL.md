---
name: wise-before-dev
description: "Use before any Wise code or product change. Loads the active Trellis task, Wise frontend/Tauri specs, product architecture constraints, and validation rules so edits stay scoped to the Agent Harness loop."
---

# Wise Before Dev

Use this skill before modifying Wise source, Trellis specs, product surfaces, Tauri commands, tests, or project skills.

## Workflow

1. Read the active task artifacts first:
   - `.trellis/tasks/<task>/prd.md`
   - `.trellis/tasks/<task>/design.md` if present
   - `.trellis/tasks/<task>/implement.md` if present
   - `implement.jsonl` or `check.jsonl` if the task provides required context files

2. Discover applicable spec layers:

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

Wise is currently a single-repo project with two main spec layers: `frontend` and `tauri`.

3. Always read `.trellis/spec/guides/index.md`.
   - If the change touches layout, ViewMode, Cockpit, Author, Inspector, Mission, Trellis runtime, Workspace semantics, or product navigation, also read `.trellis/spec/guides/agent-harness-architecture.md`.
   - If the change spans frontend and Rust IPC/database/filesystem, also read `.trellis/spec/guides/cross-layer-thinking-guide.md`.
   - If adding helpers, constants, config values, or repeated patterns, also read `.trellis/spec/guides/code-reuse-thinking-guide.md`.

4. For frontend edits, read `.trellis/spec/frontend/index.md`, then the specific guideline files named by its checklist that match the change:
   - `directory-structure.md`
   - `component-guidelines.md`
   - `hook-guidelines.md`
   - `state-management.md`
   - `quality-guidelines.md`
   - `type-safety.md`

5. For Tauri/Rust edits, read `.trellis/spec/tauri/index.md`, then the specific guideline files named by its checklist that match the change:
   - `ipc-guidelines.md`
   - `security-and-filesystem.md`
   - `persistence-and-migrations.md`

6. Read the closest existing implementation before editing:
   - Component, hook, service, store, test, CSS for frontend changes.
   - Frontend service wrapper, Rust command module, migration, path/security helper, and tests for Tauri changes.

7. State the task boundary before editing: which Loop node or domain the change serves, which files are intentionally touched, and which adjacent surfaces are out of scope.

## Wise Invariants

- Wise is a Trellis-native Agent Harness: PRD -> Plan -> Split -> Dispatch -> Run -> Verify -> Reflect.
- New UI must belong to Operator, Author, or Inspector. If it does not fit, revisit the product architecture before coding.
- Do not add single-platform top-level product surfaces. Fold them into neutral Hub, Channel, Automation, Artifact, Delegation Protocol, or runtime-control surfaces.
- Existing backend capabilities must be preserved. Prefer wrapping, aggregating, migrating, or relabeling over deleting commands, data, migrations, or integration paths.
- Frontend code must call Tauri through `src/services/*` wrappers, not raw `invoke` from components.
- Do not run dev servers (`bun run dev`, `bun run preview`, `bun run tauri:dev`) unless the user explicitly asks. Prefer focused tests and static checks.

## Validation

Choose the narrowest useful checks:

```bash
bun test
bunx tsc --noEmit --pretty false
```

For Rust/Tauri changes, add the relevant Cargo check or test command only after confirming it does not start the app.

