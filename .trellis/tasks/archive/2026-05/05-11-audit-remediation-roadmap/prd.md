# PRD: Post-Read Audit Remediation Roadmap

## Background

A deep read of the Wise codebase found several structural risks that should be tracked as Trellis work rather than kept in chat. The visible audit table called out oversized core files, near-zero coverage for critical logic, stale documentation, mixed UI systems, lockfile policy drift, repetitive migration registration, leftover Tauri template metadata, disabled CSP, and weak commit hygiene.

This parent task exists to keep those findings grouped while the actual work is executed in smaller child tasks.

## Child Tasks

| Priority | Task | Purpose |
|----------|------|---------|
| P0 | `05-11-audit-architecture-split` | Split oversized `src/App.tsx` and `src-tauri/src/lib.rs` into maintainable modules. |
| P0 | `05-11-audit-test-coverage-core` | Add regression tests around workflow, parsing, split routing, and persistence contracts. |
| P1 | `05-11-audit-readme-architecture` | Rewrite README so it describes the real Wise app and architecture. |
| P1 | `05-11-audit-ui-dependency-consolidation` | Decide and execute the Ant Design/Semi UI consolidation policy. |
| P1 | `05-11-audit-lockfile-policy` | Ensure only the correct Bun lockfile is tracked and stale npm lockfiles stay ignored. |
| P1 | `05-11-audit-migration-registration` | Replace repetitive SQLite migration registration with an ordered registry. |
| P2 | `05-11-audit-tauri-metadata-csp` | Fix Tauri package metadata and document or implement the CSP path. |
| P2 | `05-11-audit-commit-hygiene` | Define repeatable commit boundaries for large Trellis/agent/documentation changes. |

## Success Criteria

- Each visible audit finding is represented by a child task with scope and acceptance criteria.
- P0 tasks can be executed independently without depending on P1/P2 cleanup.
- Child tasks carry their own `implement.jsonl` and `check.jsonl` context entries.
- This parent task does not directly change app behavior.

## Non-Goals

- Do not implement the fixes inside this parent task.
- Do not merge unrelated refactors into one child task.
- Do not create time estimates.
