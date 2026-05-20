# Agent Registry selector UI

## Goal

Promote Codex's `AgentRegistrySection` (currently embedded inside
`ClaudeConfigDirPanel`) to a first-class settings surface in the
editorial language, plus a compact in-conversation **switch card**
modeled on AionUi's `AgentSetupCard.tsx`. Users see at a glance which
local AI execution engines are detected, switch between them, and
register custom CLI agents.

## Background

Task 1 (Codex, in progress) ships:
- `agent_registry_list / agent_registry_refresh / agent_registry_get /
  agent_registry_test_custom / agent_registry_save_custom /
  agent_registry_delete_custom`.
- A `DetectedAgent` discriminated union type on the frontend.
- An `AgentRegistrySection` component embedded inside
  `ClaudeConfigDirPanel/index.tsx` as a demo surface.

Codex's surface is functional but visually disconnected from the rest
of the editorial system. This task hosts the registry properly.

## Requirements

### R1 — Component placement

```
src/components/AgentRegistry/
  AgentRegistry.tsx               ← settings-tab-host editorial surface
  AgentRegistry.module.css        ← tokens references only
  AgentSwitchCard.tsx             ← compact conversation-side variant
  hooks/
    useAgentRegistry.ts           ← already exists (Codex); editorial wrapper around it
    useAgentSwitch.ts             ← which agent is currently selected
  rows/
    AgentRow.tsx                  ← editorial row variant
  forms/
    CustomAgentDrawer.tsx         ← add/edit a custom CLI agent
```

The existing Codex `AgentRegistrySection` inside `ClaudeConfigDirPanel`
is **kept**, but its body delegates to `<AgentRegistry compact />`
(a flag the new component supports) so visual consistency is enforced
without ripping out Codex's mount point.

### R2 — Settings surface layout

Header:
- Eyebrow: `WISE · 执行引擎 · NO. 04`.
- Section title: `Available *agents*` (italic on "agents").
- Lede: italic prose — explains that detected agents are local CLI
  binaries plus user-defined custom commands.

Stats strip (3 columns):
- Detected count
- Available count (those whose probe succeeded)
- Custom count

Tabs (`<HairlineTabs>`):
- "全部"
- "可用" (`available === true`)
- "自定义" (`kind === 'custom'`)

### R3 — Editorial rows

`<AgentRow>` per agent:
- Index in mono-s.
- Title: agent `name` (e.g. `claude`, `codex`, `gemini`, custom name).
- Author / source line: `built-in CLI · /usr/local/bin/claude` /
  `custom · /…/my-agent` (mono-m for the path).
- Description: `kind` tag in mono-m + last-probed timestamp.
- Right cluster:
  - Status dot: sage when `available`, mustard when probe failed,
    ink-3 when not yet probed.
  - "活动中" oxblood pill when the agent is currently selected as
    the active engine.
- Hover reveals: `测试`, `编辑` (custom only), `删除` (custom only)
  ghost buttons.

### R4 — Add / edit drawer

For custom agents:
- Drawer with editorial body.
- Fields: name, command (path), args (textarea, one per line), env
  (key-value editor — share `EnvKeyValueEditor` with the MCP task).
- Inline `测试` runs `agent_registry_test_custom`.
- Save calls `agent_registry_save_custom`.

### R5 — `<AgentSwitchCard>` (in-conversation variant)

A compact card mounted above the chat composer when the active agent
is unavailable or the user requests a switch. Mirrors AionUi
`AgentSetupCard.tsx` lines 66-130 in spirit, not in code.

Layout:
- Single editorial row with the active agent highlighted.
- Below: a row of ghost buttons, one per detected available agent.
- Tap → calls `useAgentSwitch.set(agent.id)`.

This is a **scaffold** for v1 — wiring the active-agent state into
chat / Mission / Trellis runtime is **out of scope**. The card
renders a placeholder selection that persists in `localStorage` so
the visual flow is reviewable.

### R6 — Surface mounting

- New tab in `AppSettingsModal` between `extensions` and `dingtalk`,
  label: "执行引擎".
- `ClaudeConfigDirPanel` continues to render the registry inline;
  it now passes `<AgentRegistry compact />` instead of the existing
  `AgentRegistrySection` markup. The compact variant hides the
  header and stats strip.
- `<AgentSwitchCard>` is exported but not auto-mounted in v1; a
  follow-up task wires it into `Cockpit` once active-agent state
  exists.

### R7 — Tests

- `useAgentRegistry.test.ts` — list / refresh / save / delete
  round-trip with mocked invoke.
- `AgentRow.test.tsx` — kind tag color, status dot, active pill.
- `CustomAgentDrawer.test.tsx` — required-field validation; test +
  save flow ordering.

### R8 — Preview update

Append an Agent Registry section to `preview.html` with one row per
kind (claude / codex / gemini / custom) and a sketch of the switch
card.

## Constraints

- Codex's existing `AgentRegistrySection` mount inside
  `ClaudeConfigDirPanel` is preserved — only its inner content
  delegates to the new component. This avoids stomping Codex's work.
- `useAgentRegistry.ts` if Codex shipped one stays the source of
  truth; this task **wraps** rather than replaces.
- `agent_registry_test_custom` results map onto `<McpTestResult>`
  visual conventions (sage / mustard / ink-3 dots) for consistency
  across the catalog surfaces.
- No active-engine state machine is built here; that belongs to a
  later runtime task. The switch card persists selection to
  `localStorage` only as a visual placeholder.
- No new runtime dependency.

## Acceptance Criteria

- [ ] `bun test src/components/AgentRegistry` passes.
- [ ] `bunx tsc --noEmit` clean.
- [ ] Listing agents against the live Tauri commands shows every
      built-in CLI plus any persisted custom agent, with correct
      status dots.
- [ ] Adding a custom agent persists and re-renders without app
      restart.
- [ ] `<AgentRegistry compact />` mounts inside `ClaudeConfigDirPanel`
      and matches the standalone surface's typography and spacing
      modulo the header.
- [ ] `<AgentSwitchCard>` renders against a static fixture and writes
      its placeholder selection to `localStorage`.
- [ ] No `Inter`, `Roboto`, or `Arial` in the new module.

## Out of Scope

- Wiring active-agent selection into chat / Mission / Trellis.
- Per-conversation model / mode pickers (AionUi
  `AcpModelSelector` / `AgentModeSelector` analogs).
- Remote agents (WebSocket endpoints).
- Extension-contributed agents.

## Notes

- This task ships **last** of the four feature tasks because it
  depends on Codex's Task 1 having landed.
- Coordinate with Codex before the drawer ships: confirm the existing
  `useAgentRegistry` hook (if one) covers list / refresh / save /
  delete; otherwise this task adds it.
