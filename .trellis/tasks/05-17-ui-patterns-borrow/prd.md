# UI patterns borrow set

## Goal

Lift three concrete UI patterns from AionUi into wise and prove them by
refactoring **one** existing settings page. The patterns are: Settings
dual-mode (modal vs route page) via a Context tag; sider drag-collapse
with hysteresis; hook-composition container pattern (one hook per concern,
container does only assembly). No new functionality; the test of success
is a cleaner refactor of an existing page plus reusable primitives.

## Background

AionUi UI patterns worth borrowing (no code copy — Arco vs Ant Design
differ):

- **Dual-mode settings**: `SettingsModal/settingsViewContext.tsx` defines
  a `SettingsViewModeProvider` with value `'modal' | 'page'`. Each settings
  panel reads `useSettingsViewMode()` and adjusts (e.g., header rendering,
  paddings). Single component tree, two visual containers
  (`SettingsModal/index.tsx:134-441`, `AgentSettings/index.tsx:13`).
- **Sider drag hysteresis**: `Layout.tsx:358-405`. `SNAP_THRESHOLD =
  (250+64)/2`, `HYSTERESIS = 6`. Prevents jittery toggling between
  expanded and collapsed when the user drags through the boundary.
- **Hook-composition container**: `McpManagement.tsx` is the canonical
  example. Each concern is a hook
  (`useMcpServers / useMcpAgentStatus / useMcpOperations / useMcpModal /
  useMcpServerCRUD / useMcpOAuth / useMcpConnection`); the container
  composes them into wrappers (`wrappedHandleAddMcpServer`) and renders.

wise current state:

- `src/components/` has settings surfaces but no dual-mode mechanism.
  Adding a settings panel today requires duplicating layout for the modal
  vs page case.
- The current sider (if any) does not have hysteresis on drag-collapse.
- Existing settings panels mix data fetching, mutation, and rendering in
  one component.

## Requirements

### R1 — Dual-mode settings primitive

- New module `src/components/SettingsView/settingsViewContext.tsx`:
  - `<SettingsViewModeProvider value={'modal' | 'page'}>`.
  - `useSettingsViewMode()` hook returning the current mode.
  - `<SettingsPageWrapper>` thin wrapper for the `'page'` case (header,
    breadcrumb, padding); the `'modal'` case stays unwrapped.
- The primitive lives separately from any concrete settings panel.

### R2 — Sider drag hysteresis utility

- New hook or utility `src/hooks/useSiderDragSnap.ts`:
  - Inputs: `width`, `setWidth`, `collapsed`, `setCollapsed`, optional
    `expandedWidth`, `collapsedWidth`, `hysteresisPx`.
  - Implements the SNAP_THRESHOLD + HYSTERESIS algorithm so a drag that
    passes the threshold by less than `hysteresisPx` does not flip back
    immediately if the user reverses direction.
- A focused unit test demonstrates the hysteresis behavior with a
  scripted drag sequence.

### R3 — Hook-composition container pattern (template)

- Pick **one** existing settings panel in `src/components/` that is
  currently a single component mixing fetch/mutation/render.
- Refactor it into:
  - Per-concern hooks under a new `hooks/` subdirectory adjacent to the
    component.
  - A container component that composes the hooks and renders.
- The refactor must be **behavior-preserving**: any existing tests
  continue to pass; the user-visible surface is unchanged.
- The new structure is documented in
  `.trellis/spec/frontend/index.md` (or a sibling) as a reference pattern
  others should follow.

### R4 — Demo dual-mode page

- Take the panel refactored in R3 and:
  - Mount it inside a settings modal as the `'modal'` case (if a modal
    surface exists).
  - Mount it inside a route page as the `'page'` case (if a page surface
    exists).
  - If only one container exists today, document the second case as a
    forward-compatible scaffold (one-line example, no full
    implementation).

### R5 — Tests

- Unit test for `useSiderDragSnap`: scripted drag input → expected
  collapse/expand transitions with and without hysteresis.
- Unit test for `useSettingsViewMode`: throws if used outside the
  provider; returns the right value inside.
- Existing tests for the refactored panel continue to pass.

## Constraints

- Behavior-preserving. No user-visible regressions.
- No new dependencies. Pure React + existing wise UI library
  (Ant Design + Semi-only-where-allowed).
- No `pages/` directory introduced.
- One settings panel only — do not refactor multiple panels in this task.
- Document the chosen panel in design.md before editing.
- English source.

## Acceptance Criteria

- [ ] `bun test src/hooks/useSiderDragSnap.test.ts` passes.
- [ ] `bun test src/components/SettingsView` passes.
- [ ] The refactored settings panel passes any existing tests it had,
      plus at least one new test demonstrating the hook-composition
      structure (e.g., a hook stub can be replaced and the container
      renders against the stub).
- [ ] `bunx tsc --noEmit` clean.
- [ ] No file outside `src/components/SettingsView/`, `src/hooks/`,
      the chosen panel's directory, and `.trellis/spec/frontend/*` is
      modified.
- [ ] A new entry in `.trellis/spec/frontend/index.md` (or a sibling
      document) names the refactored panel as the canonical reference for
      the hook-composition pattern.

## Out of Scope

- Refactoring more than one panel.
- Replacing the existing UI library or theming system.
- AionUi's `MutationObserver`-pinned custom CSS pattern (separate task
  if/when needed).
- Sider lazy-mount + keep-alive iframe pattern (extension task may
  borrow it later).
- Per-conversation pickers — agent task scope.

## Notes

- Sider hysteresis math uses an average of `expandedWidth` and
  `collapsedWidth` as the snap point: `(250 + 64) / 2 = 157`. Hysteresis
  6px is the AionUi default and is fine for wise.
- Design and implement docs must be filled before `task.py start`.
