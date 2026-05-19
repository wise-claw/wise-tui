# UI editorial integration for AionUi-borrowed subsystems

## Goal

Stand up production-grade UI for the four backend subsystems we recently
borrowed from AionUi (Extensions Hub, Skills Hub, MCP server management,
Agent Registry), unified under a single visual language: a **refined
editorial** aesthetic that sits on top of Ant Design without replacing
it. Ship one design system task plus four feature tasks; deliver a
visual preview before any feature task starts implementation.

## Background

Four greenfield Tauri command surfaces are already in place:

- `extensions_*` (Task 3, completed)
- `skills_*` (Task 4, completed)
- `mcp_*` (Task 2, structural skeleton — completed)
- `agent_registry_*` (Task 1, in progress under Codex)

Renderer surfaces today are partial:

- `SkillsHub.tsx` has a registry-search UI plus a roughly-wired external-
  browse mode (Task 4 stub).
- `ClaudeMcpConfigPanel.tsx` exists but is Claude-bound; the new neutral
  `mcp_*` commands have no UI.
- `ExtensionRegistry` has no UI at all.
- `AgentRegistry` has a section embedded inside `ClaudeConfigDirPanel`
  (Codex's Task 1 demo surface) but no first-class home.

The lack of a shared visual language across these surfaces will produce a
patchwork product. This task imposes one coherent aesthetic up front and
ships the integration in five gated steps.

## Requirements

### R1 — Visual language committed before code

The aesthetic direction is **refined editorial**. See child task
`05-17-ui-design-system/prd.md` §1–§7 for the full specification:
typography (Fraunces / Switzer / JetBrains Mono), color tokens
(paper / ink / oxblood), motion contract (page-entry choreography +
two interaction beats), and the eight component primitives.

A single static HTML preview lives at
`.trellis/tasks/05-17-ui-editorial-integration/preview.html` and is the
canonical reference for tone, density, and hierarchy. Any feature task
that diverges from the preview without an explicit decision logged in
its design.md is rejected at review.

### R2 — One design system task, four feature tasks

Children, in dependency order:

1. `05-17-ui-design-system` — primitives + tokens + AntD interop layer.
2. `05-17-ui-extensions-hub` — first feature surface to land; validates
   the primitives in production code.
3. `05-17-ui-skills-hub` — replaces the temporary external-browse stub.
4. `05-17-ui-mcp-management` — neutral MCP catalog UI distinct from
   `ClaudeMcpConfigPanel`.
5. `05-17-ui-agent-registry-selector` — extracts Codex's embedded
   `AgentRegistrySection` to a first-class surface (with Codex's
   permission).

Feature tasks **must** consume primitives from `EditorialUI/`. Any
subsystem-specific styling lives in a single co-located `.module.css`
that references `tokens.css` variables — never inline values.

### R3 — Hosting decisions

- Extensions Hub mounts as a new tab inside `AppSettingsModal` (modal
  case) plus a `'page'` mode mount via `SettingsViewModeProvider`
  (already shipped in Task 5) so a future route can reuse it.
- Skills Hub keeps its current entry point (`AppWorkspaceLayout` overlay
  + `AuthorPanel` pane). The hub component itself is rewritten on top of
  the editorial primitives.
- MCP management ships as a new top-level entry inside `AppSettingsModal`
  (so users have a single place to manage cross-engine MCP servers,
  separate from the existing Claude-only MCP panel).
- Agent Registry selector becomes a new settings tab. Codex's
  `AgentRegistrySection` continues to render inside `ClaudeConfigDirPanel`
  for backward compatibility but redirects through the same primitives
  for visual consistency.

### R4 — AntD coexistence

The editorial layer **augments** AntD; it does not replace `Modal`,
`Form`, `Input`, `Select`, `Drawer`, `message`, or `notification`. AntD
component overrides are limited to:

- Border color → `var(--rule)`.
- Border radius → 0 on most surfaces; 4px on buttons; 2px on inputs.
- Focus state → 2px `var(--oxblood)` with 2px paper offset.
- Modal / Drawer body bg → `var(--paper)`.
- Table header → caption typography + JBM for IDs.

These overrides ship from a single CSS file imported alongside
`tokens.css` so the editorial scope is contained.

### R5 — Motion + accessibility

- Page-entry choreography per design system §6, capped at 8 staggered
  rows; the rest fade in as a group at 480ms.
- Hover-state interactions are CSS-only.
- `prefers-reduced-motion` disables every animation and transition
  except opacity on entry.
- Every interactive primitive carries a 2px oxblood focus ring with 2px
  paper offset.

### R6 — Verification

Each feature task ships:
- A static HTML preview update at
  `.trellis/tasks/05-17-ui-editorial-integration/preview.html` (the file
  grows section by section as each surface lands).
- A React implementation that visually matches the preview block.
- One `bun:test` per non-trivial hook (CRUD wiring, state derivation).
- No new runtime dependency.

## Constraints

- AntD + Semi UI policy preserved (Semi only for `ClaudeChatInput`).
- No `pages/` directory introduced.
- No new icon font; reuse `@ant-design/icons` where existing components
  already pull from it.
- All copy in surfaces stays in **Chinese** (existing wise convention)
  but type tokens, component names, and code identifiers stay in
  English.
- Fonts are loaded from CDN. Fallback to `system-ui` + `serif` +
  `ui-monospace` if the import fails — the layout must remain legible.
- Light theme only for v1.

## Acceptance Criteria

- [ ] `EditorialUI/` ships eight primitives + `tokens.css`.
- [ ] `preview.html` renders Extensions Hub, Skills Hub, MCP catalog,
      and Agent Registry sections on a single page that loads the real
      fonts and exhibits the entry choreography.
- [ ] Each of the four feature surfaces is implemented in React and
      passes the corresponding child task's acceptance criteria.
- [ ] No Inter, Roboto, or Arial usage anywhere in the new surfaces
      (`grep -RIn "Inter\|Roboto\|Arial" src/components/EditorialUI/
      src/components/Extensions* src/components/SkillsHub/
      src/components/Mcp*/ src/components/AgentRegistry*/` returns
      empty).
- [ ] No regression in existing AntD-driven surfaces (Cockpit,
      LeftSidebar, Inspector). `bunx tsc --noEmit` clean. Existing
      `AuthorPanel.test.tsx` and `useViewMode.test.tsx` pass.
- [ ] Lighthouse contrast audit on `preview.html` reports zero
      contrast failures.

## Out of Scope

- Dark theme (separate task).
- Mobile / narrow-viewport responsive design beyond a graceful
  collapse below 960px (no dedicated mobile layout).
- Replacement of existing Claude-bound MCP UI (`ClaudeMcpConfigPanel`)
  — the new neutral surface coexists.
- Extension marketplace / install-from-URL (manifest install only,
  same as Extension System task §Out of Scope).
- I18n of the new surfaces (Chinese copy only).

## Notes

- Children link via the parent reference field set during creation
  (`task.py create … --parent`).
- The HTML preview file is the **handoff artifact** between this
  parent and any feature task. It evolves; treat it like a typeset
  sketch, not a static screenshot.
