# Frontend Development Guidelines

> Project-specific React, TypeScript, and desktop UI conventions for Wise.

---

## Scope

Wise is a Tauri 2 desktop application with a React 19 + Vite + Bun frontend.
The frontend is the orchestration surface for repositories, Claude sessions,
workflow graphs, PRD splitting, terminal sessions, notifications, and settings.

The active frontend stack is:

- React 19 with functional components and hooks.
- TypeScript in strict mode.
- Vite 7 with Bun as the package manager and test runner.
- Ant Design as the default UI system; Semi UI is retained only for the Claude
  composer `AIChatInput`.
- Ant Design Icons, X6, Milkdown, Monaco, and xterm.
- Tauri IPC wrappers in `src/services/`; UI code should not call raw commands directly.

These files describe how to add code that looks native to the current project.
They are implementation specs, not aspirational rewrite plans.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Active |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Active |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, async side effects, runtime streams | Active |
| [State Management](./state-management.md) | Local state, app state, persisted state, IPC state | Active |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, testing, accessibility, review checklist | Active |
| [Type Safety](./type-safety.md) | Type patterns, DTOs, validation, forbidden casts | Active |

Tauri-side frontend/backend contracts are documented in
[`../tauri/index.md`](../tauri/index.md).

---

## Pre-Development Checklist

Before editing frontend code:

1. Read the closest existing component, hook, service, test, and CSS file.
2. Check whether the change belongs in UI, hook orchestration, service logic, or Rust IPC.
3. Reuse existing dependencies before adding new UI, state, parsing, or graph libraries.
4. Keep new Tauri calls behind `src/services/*` wrappers.
5. Prefer extracting new logic out of `src/App.tsx` unless the change is truly app-shell coordination.
6. Add focused tests for pure logic, parsers, workflow transitions, or data normalization.

---

## Quality Gate

For frontend-only changes, run checks that do not start a dev server:

```bash
bun test
```

Do not run `bun run dev`, `bun run preview`, `bun run tauri:dev`, or other
frontend serve/start commands for this project.

---

## Canonical Examples

- `src/services/repository.ts` shows thin Tauri invoke wrappers.
- `src/hooks/useRepositoryList.ts` shows app orchestration with service calls and local derived state.
- `src/services/workflow/engine.ts` shows pure workflow domain logic.
- `src/services/workflow/acceptanceVerdict.ts` shows runtime validation for untrusted text/JSON.
- `src/components/ClaudeSessions/` shows feature component grouping with colocated CSS.
- `src/components/WorkflowConfigModal/` shows a large feature modal backed by service-layer workflow code.

---

**Language**: This documentation is written in English because Trellis specs are
loaded into coding agents. User-facing conversation remains Chinese.
