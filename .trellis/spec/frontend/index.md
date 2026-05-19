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
- `src/components/ClaudeConfigDirPanel/` is the canonical reference for the
  hook-composition container pattern: a fetch hook (`useClaudeConfigDir`),
  a derive-state hook (`useClaudeConfigDirChoice`), and render-only
  sub-components, assembled by a thin `index.tsx`. Settings panels meant to
  be embedded in both modal and route-page surfaces should consume
  `useSettingsViewMode()` from `src/components/SettingsView/` so the same
  panel adapts without duplication.
- `src/components/HubCard/` is the shared visual primitive set for new
  settings hub panels (extensions / MCP catalog / agent registry / skills).
  Composes a header (icon + title + pill + actions + meta), tag pills with
  six AntD-aligned tones, status dots, and an items list. Panels live one
  per concern under `src/components/<Hub>Panel/` and mount inside
  the Author-domain configuration center as additional panes (see
  `ExtensionsPanel`, `McpHub`, `SkillsHub`, `WiseHubPanel`). Legacy
  `AppSettingsModal` usage is a compatibility shell for extension settings,
  not a second builtin settings system. Colour, border, and radius pull from
  AntD CSS variables so dark theme inherits without override.

## Configuration Center Product Rule

Wise is evolving toward an AionUi-style AI workbench. Every builtin menu item
must be reviewed as part of the workbench loop instead of preserved as a
historic interaction:

- Put builtin settings under the Author-domain configuration center. Do not
  add another top-level settings button or single-platform menu entry.
- Prefer Chinese labels for menu items, status text, actions, and empty states.
- Backend changes are allowed when they support Hub, Channel, Automation,
  Artifact, Team Mode, or runtime-environment productization. Preserve existing
  capabilities by wrapping, migrating, or aggregating them instead of deleting
  commands or data.
- Single-platform integrations such as DingTalk must live under a platform-
  neutral Channel / Remote Access surface.
- Settings pages should be operational workbench panels: current state,
  source/scope, actionable controls, and clear impact boundaries. Avoid long
  explanatory pages that duplicate scattered legacy entry points.
- Review every configuration-center menu as a product surface before editing:
  state its workbench responsibility, what AionUi interaction it borrows, and
  whether backend aggregation is needed. Backend changes are acceptable when
  they preserve existing capabilities and make the menu more coherent.

---

**Language**: This documentation is written in English because Trellis specs are
loaded into coding agents. User-facing conversation remains Chinese.
