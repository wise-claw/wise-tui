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
├── AppImpl.tsx                      # Workspace implementation surface invoked by App.tsx
├── App.css                          # App-shell styles
├── mascot.css                       # Mascot window styles
├── bootstrapDompurifyForTauriAssets.ts  # DOMPurify bootstrap for asset:// resources
├── vite-env.d.ts                    # Vite ambient types
├── components/                      # Feature and shared UI components
│   ├── ClaudeSessions/
│   ├── WorkflowConfigModal/
│   ├── PrdTaskSplitPanel/
│   ├── Cockpit/
│   ├── MissionControl/
│   └── ...
├── hooks/                           # Reusable stateful orchestration hooks
│   ├── useClaudeSessions.ts
│   ├── useRepositoryList.ts
│   ├── useViewMode.ts
│   └── ...
├── services/                        # IPC wrappers, domain services, pure logic
│   ├── claude.ts
│   ├── repository.ts
│   ├── workflow/
│   ├── prdSplit/
│   ├── mission/
│   ├── trellis/
│   └── workflowGraphRuntime.ts
├── features/                        # Larger feature integrations
│   └── cc-wf-studio/                #   cc-workflow-studio host integration
├── cc-workflow-studio-core/         # Pure workflow definition and prompt generation
├── stores/                          # Small external subscription stores
├── notifications/                   # Notification hub, ingest, shared types
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
- `src/components/<Feature>/<domainLogic>.ts` for pure feature-local logic.
- `src/components/<Feature>/use<Thing>.ts` for feature-local state orchestration.
- `src/components/<Feature>/<domainLogic>.test.ts` for tests around extracted
  pure logic.
- `src/hooks/use<Thing>.ts` when stateful behavior is reused or would make a component too large.
- `src/services/<domain>.ts` for IPC wrappers or domain service functions.
- `src/services/<domain>/` when the service becomes a small subsystem.
- `src/utils/<domain>.ts` for pure functions that have no React or Tauri dependency.

Examples:

- `src/components/ClaudeSessions/` groups the session timeline, message rows,
  docks, and status surfaces for Claude execution.
- `src/components/CockpitSurface/` owns the assistant Hub, assistant header,
  assistant conversation/workspace shell, and assistant settings drawer. Hub
  cards should render all `AssistantEntry.source === "builtin"` rows returned
  by `assistants_list`; do not special-case `builtin:prd-split` as the only
  Wise builtin.
- `src/services/workflow/` contains engine, replay, facade, event store, and adapters.
- `src/services/prdSplit/` contains the PRD split planning, dispatch, and
  Trellis writer pipeline plus their unit tests.
- `src/features/cc-wf-studio/` hosts the cc-workflow-studio integration
  surface, while `src/cc-workflow-studio-core/` holds the pure workflow
  definition and prompt generation logic.
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

Within a feature folder, internal modules may import each other, but unrelated
features should import only the public feature entry unless a shared module has
been promoted to a higher layer.

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
- Assistant Hub settings: `src/components/CockpitSurface/AssistantSettingsDrawer.tsx`
  calls `src/services/assistantPromptLayers.ts` for runtime resolution and
  override persistence, and uses `src/services/skills.ts` to scan existing
  skills directories before adding mounted skill refs to the assistant bundle.
  Keep scan-to-bundle pure helpers in
  `src/components/CockpitSurface/assistantSkillMount.ts` with focused tests.
  Components must not call assistant override IPC directly.
- Thin IPC service: `src/services/repository.ts`.
- Runtime stream hook: `src/hooks/useClaudeSessions.ts`.
- Pure tested domain logic: `src/services/workflow/engine.ts`.
- Runtime JSON validation: `src/services/workflow/acceptanceVerdict.ts`.
