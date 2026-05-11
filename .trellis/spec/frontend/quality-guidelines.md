# Quality Guidelines

> Code quality standards for frontend development in Wise.

---

## Overview

Quality means preserving the desktop app's runtime contracts: Tauri IPC,
workflow orchestration, Claude process streams, SQLite-backed persistence, and
dense operational UI. Prefer small, testable modules and explicit boundaries
over adding more responsibility to already-large files.

---

## Required Patterns

- Use Bun for JavaScript/TypeScript package scripts.
- Use `bun test` for the current frontend test suite.
- Keep Tauri command calls in `src/services/*`.
- Keep pure workflow/parsing/normalization logic outside React components.
- Add focused tests for pure logic and business-critical parsers.
- Use `Promise.all` for independent async reads.
- Trim and normalize user-entered IDs, names, keys, and paths before persistence.
- Keep event names and shared constants in `src/constants/*`.
- Preserve existing UI libraries before adding new dependencies.

---

## Forbidden Patterns

- Do not run frontend dev/build/start/serve commands during agent verification
  for this project unless the user explicitly changes that rule.
- Do not call `invoke` directly from components.
- Do not add durable application state to `localStorage`.
- Do not add new `any` types.
- Do not store high-frequency streams directly in React state.
- Do not mutate arrays or objects in state.
- Do not introduce a new state library, router, CSS framework, or UI framework
  without a project-level reason.
- Do not broaden desktop file access or asset protocol scope from frontend code.
- Do not grow `src/App.tsx` for feature-specific logic that can live elsewhere.

---

## Testing Requirements

Add or update tests when changing:

- Workflow engine transitions and replay behavior.
- Acceptance verdict parsing and structured decision gates.
- PRD/task splitting, validation, and normalization.
- Persistence adapters or JSON migration logic.
- Utilities that resolve repository/session/task identity.
- Any parser for Claude, terminal, MCP, plugin, or file output.

Existing examples:

- `src/services/workflow/engine.test.ts`
- `src/services/workflow/acceptanceVerdict.test.ts`

Run:

```bash
bun test
```

The TypeScript config currently excludes `src/**/*.test.ts` from `tsc`; Bun is
the test runner for those files.

---

## Review Checklist

Before considering frontend work done, check:

- Is the new code in the correct layer?
- Are IPC calls behind a service wrapper?
- Are untrusted JSON/text inputs validated?
- Are loading, empty, error, and cancellation states represented?
- Are long-running event subscriptions cleaned up?
- Are expensive derived values memoized or moved out of render?
- Is durable state persisted through the existing service/Rust layer?
- Does the UI remain dense, scannable, and keyboard/mouse usable?
- Are tests added for pure logic or high-risk contracts?

---

## UI Quality

Wise is a desktop productivity tool. The UI should feel quiet, dense, and
operational:

- Prioritize scanning, comparison, and repeated action.
- Use familiar controls: icons for tools, toggles for binary settings, tabs for views.
- Avoid marketing sections, decorative cards, and generic landing-page layouts.
- Do not put cards inside cards.
- Keep text within its container on narrow and wide windows.
- Use stable dimensions for toolbar controls, counters, graph nodes, and list rows.
- Avoid one-note palettes dominated by a single hue family.

---

## Common Mistakes

- Treating Wise like a browser app and introducing route/page structure prematurely.
- Hiding backend failures with `catch {}` in places where the UI needs feedback.
- Testing only the happy path for parser changes.
- Forgetting that GUI app PATH differs from a login shell PATH.
- Adding UI controls whose labels overflow in compact desktop panes.
