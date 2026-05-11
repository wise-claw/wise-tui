# Component Guidelines

> How React components are built in Wise.

---

## Overview

Components are functional React components written in TypeScript. The current
application favors explicit props, colocated feature CSS, and pragmatic
composition over framework-heavy abstractions.

Components should render UI and handle direct interaction. Business rules,
Tauri IPC, persistence, parsing, and workflow transitions should live in hooks,
services, utilities, or Rust commands.

---

## Component Structure

Use this shape for new feature components:

```tsx
import { Button } from "antd";
import type { Repository } from "../../types";
import "./index.css";

interface RepositoryActionPanelProps {
  repository: Repository;
  busy: boolean;
  onOpen: (repository: Repository) => void;
}

export function RepositoryActionPanel({
  repository,
  busy,
  onOpen,
}: RepositoryActionPanelProps) {
  return (
    <section className="repository-action-panel">
      <Button loading={busy} onClick={() => onOpen(repository)}>
        Open
      </Button>
    </section>
  );
}
```

Rules:

- Define a named `Props` interface for exported components.
- Destructure props in the function signature when readable.
- Keep helper functions outside the component when they do not need render state.
- Do not define child components inside parent components.
- Use early returns for loading, empty, and unavailable states when that is clearer.

---

## Props Conventions

- Name callback props as `onAction`: `onSelect`, `onClose`, `onRetry`.
- Name internal handlers as `handleAction`: `handleSelect`, `handleClose`.
- Keep props serializable or stable where possible; avoid passing large mutable objects.
- Pass IDs or domain DTOs deliberately. Do not pass partially shaped objects without a type.
- Use optional props only when the component has a real default behavior.
- Prefer discriminated unions for mutually exclusive states.

Example:

```tsx
type TaskBadgeState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "failed"; message: string };
```

---

## Composition

- Keep reusable presentational pieces small, but do not split components only to
  reduce line count.
- Extract when the new component has a name from the product domain, owns a
  repeated UI pattern, or isolates expensive rendering.
- Keep orchestration in hooks when several components need the same stateful behavior.
- Use Ant Design as the default UI system for new controls, layout primitives,
  feedback, overlays, forms, tables, tabs, and icons.
- Semi UI is allowed only for the Claude composer `AIChatInput` integration
  under `src/components/ClaudeChatInput/`; its tokens must be bridged to Ant
  Design variables through `composer-semi-tokens.css`.
- Do not introduce new Semi UI usage outside the composer without first
  documenting why Ant Design cannot satisfy the interaction.
- Use existing icons from `@ant-design/icons`, `@vscode/codicons`, or
  `src/components/icons/` before adding another icon package.

---

## Styling Patterns

The project uses regular CSS files imported by components.

- Colocate feature styles as `index.css` beside `index.tsx`.
- Use stable class names; do not rely on generated class selectors from UI libraries.
- Prefix classes with the feature or app area when practical.
- Use CSS variables when a value must stay consistent across a feature.
- Avoid nested card-on-card layouts for dense desktop tools.
- Keep desktop work surfaces dense, scannable, and operational rather than
  marketing-like.
- Use stable dimensions for boards, toolbars, icon buttons, counters, and grids
  so hover states and dynamic labels do not shift the layout.
- Do not scale font size with viewport width.

Example:

```tsx
<div className="workflow-config-modal">
  <div className="workflow-config-modal__toolbar">...</div>
  <div className="workflow-config-modal__canvas">...</div>
</div>
```

---

## Accessibility

Wise is a desktop app, but UI still needs accessible interaction basics:

- Buttons must have visible labels or `aria-label`.
- Icon-only controls must have a tooltip or accessible label.
- Inputs must be labeled by visible text, `aria-label`, or `aria-labelledby`.
- Modal and drawer close actions must remain reachable by keyboard.
- Do not rely on color alone to communicate state.
- Preserve focus after async actions when possible.

---

## Performance

- Use `useMemo` for expensive derived arrays, maps, grouping, sorting, and graph projections.
- Use `useCallback` when a handler is passed into memoized children or effect dependencies.
- Use refs for high-frequency mutable runtime state such as process output or timers.
- Use `Map` and `Set` for repeated lookup by ID.
- Load heavy UI modules only where the feature needs them.
- Avoid inline component definitions because they remount on every render.

---

## Common Mistakes

- Calling `invoke` from a component. Put the call in `src/services/*`.
- Adding new cross-feature state directly to `App.tsx` when a hook or service can own it.
- Copying similar modal/list/table logic instead of extracting a feature part.
- Using `useEffect` to derive data that can be computed during render.
- Adding another UI library for a single control.
- Creating large anonymous object/array props inline for frequently rendered children.
