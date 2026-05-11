# Directory Structure

> How frontend code is organized in Wise.

---

## Overview

The frontend is organized by runtime responsibility rather than by routes.
Wise is not currently a route-based web app; `src/App.tsx` is the desktop
workspace shell, and feature surfaces are mounted inside that shell.

Keep new code close to the layer that owns it:

- UI and interaction components go in `src/components/`.
- Stateful reusable orchestration goes in `src/hooks/`.
- Tauri IPC wrappers and pure service modules go in `src/services/`.
- Pure synchronous helpers go in `src/utils/`.
- Shared constants go in `src/constants/`.
- Cross-feature types go in `src/types.ts` or `src/types/`.

---

## Directory Layout

```text
src/
├── main.tsx                         # Main window React entry
├── mascot.tsx                       # Mascot window React entry
├── App.tsx                          # Desktop workspace shell and cross-panel coordination
├── App.css                          # App-shell styles
├── components/                      # Feature and shared UI components
│   ├── ClaudeSessions/
│   ├── WorkflowConfigModal/
│   ├── PrdTaskSplitPanel/
│   └── ...
├── hooks/                           # Reusable stateful orchestration hooks
│   ├── useClaudeSessions.ts
│   ├── useRepositoryList.ts
│   └── ...
├── services/                        # IPC wrappers, domain services, pure workflow logic
│   ├── claude.ts
│   ├── repository.ts
│   ├── workflow/
│   └── workflowGraphRuntime.ts
├── stores/                          # Small external subscription stores
├── notifications/                   # Notification domain modules
├── constants/                       # Shared constants and event names
├── types/                           # Domain type modules
├── types.ts                         # Legacy shared cross-domain types
├── utils/                           # Pure helpers
└── assets/                          # Static frontend assets
```

Do not add `pages/` unless real routing is introduced. New desktop panels,
drawers, modals, and work surfaces belong under `src/components/`.

---

## Module Organization

Use the smallest layer that can own the behavior cleanly:

- `src/components/<Feature>/index.tsx` for a component with local view logic.
- `src/components/<Feature>/index.css` for feature-specific styles.
- `src/components/<Feature>/<Part>.tsx` for meaningful subcomponents.
- `src/hooks/use<Thing>.ts` when stateful behavior is reused or would make a component too large.
- `src/services/<domain>.ts` for IPC wrappers or domain service functions.
- `src/services/<domain>/` when the service becomes a small subsystem.
- `src/utils/<domain>.ts` for pure functions that have no React or Tauri dependency.

Examples:

- `src/components/ClaudeSessions/` groups the session timeline, message rows,
  docks, and status surfaces for Claude execution.
- `src/services/workflow/` contains engine, replay, facade, event store, and adapters.
- `src/hooks/useClaudeSessions.ts` coordinates process execution, event streams,
  session tabs, and transient runtime state.
- `src/services/repository.ts` keeps repository IPC calls away from components.

---

## Naming Conventions

- Component directories use `PascalCase`: `WorkflowConfigModal`, `ClaudeSessions`.
- Component files use `PascalCase.tsx` for named subcomponents or `index.tsx`
  for the directory entry.
- Hook files use `useThing.ts`.
- Service, utility, and constant files use lower camel case or domain-kebab
  already established by nearby files: `workflowGraphRuntime.ts`,
  `taskSplitOutputSchemaValidator.ts`.
- Exported component names use `PascalCase`.
- Exported functions and variables use `camelCase`.
- Type and interface names use `PascalCase`.
- CSS classes use kebab-case, with a feature prefix when practical:
  `.app-*`, `.claude-*`, `.workflow-*`, `.terminal-*`.

---

## Import Boundaries

- Components may import hooks, services, constants, types, and utilities.
- Hooks may import services, constants, types, and utilities.
- Services may import Tauri APIs, types, constants, and pure utilities.
- Utilities should not import React or Tauri APIs.
- Tests should target service and utility modules directly when possible.

Avoid cross-importing between unrelated feature component directories. Extract
shared UI or logic to `components/`, `hooks/`, `services/`, or `utils/`.

---

## Growth Rules

`src/App.tsx` and `src-tauri/src/lib.rs` are already large coordination files.
New behavior should normally be extracted to a component, hook, service, or Rust
module instead of increasing those files further.

Add code to `App.tsx` only when it coordinates the whole desktop shell, such as
global layout, active repository/project selection, app-wide modals, or
cross-panel event wiring.

---

## Examples To Follow

- Feature UI with colocated styles: `src/components/ProjectList/index.tsx`
  and `src/components/ProjectList/index.css`.
- Thin IPC service: `src/services/repository.ts`.
- Runtime stream hook: `src/hooks/useClaudeSessions.ts`.
- Pure tested domain logic: `src/services/workflow/engine.ts`.
- Runtime JSON validation: `src/services/workflow/acceptanceVerdict.ts`.
