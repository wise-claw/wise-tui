# UI design system — AntD-aligned hub primitives

> Shared visual primitives for the settings hub panels (Extensions, MCP,
> Skills, Agents). Stays inside Ant Design — no new UI framework, no
> custom font stack, no shadow library. Provides one composable
> `HubCard` and a small palette of pills/dots so every borrowed-subsystem
> surface looks the same without each panel reinventing layout.

## 1. Direction (post-iteration)

The earlier "refined editorial" direction (serif typography, oxblood
accent, narrow centred column) was rejected as too far from desktop
tooling and from AntD defaults. The shipped direction is **AntD-aligned
+ AionUi-style hub cards**: full-width modal layout (left nav 200px,
right pane fills), AntD primary blue, system fonts, AntD borders /
radii / spacing, hash-coloured letter avatars, six tag tones tied to
AntD semantic palette.

## 2. Tokens

All colour, border, and radius values come from AntD CSS variables:

| Token | Source |
|---|---|
| Surface bg / fill / elevated | `--ant-color-bg-container`, `--ant-color-fill-quaternary`, `--ant-color-bg-layout` |
| Text 1 / 2 / 3 / 4 | `--ant-color-text`, `--ant-color-text-secondary`, `--ant-color-text-tertiary`, `--ant-color-text-quaternary` |
| Border 1 / 2 | `--ant-color-border-secondary`, `--ant-color-border` |
| Primary | `--ant-color-primary`, `--ant-color-primary-bg`, `--ant-color-primary-border` |
| Status | `--ant-color-success`, `--ant-color-warning`, `--ant-color-error` |
| Mono | `--ant-font-family-code` |

No hex literal in the new module CSS. Dark theme inherits the moment
AntD's `algorithm` flips because everything resolves through the
variable layer.

Avatar palette is the only literal-colour set, mirroring AionUi:
`#165DFF #00B42A #722ED1 #F5319D #F77234 #14C9C9`. Hash a name into one
of these via `avatarColorFor(name)` (exported from `HubCard/index.tsx`).

## 3. Spacing & radii

Standard AntD radii (4 / 6 / 8 / 12). Card padding 20–24px. Item gap
4px. The hub follows desktop density, not editorial whitespace.

## 4. Component primitives

Shipped under `src/components/HubCard/index.tsx`:

| Primitive | Purpose |
|---|---|
| `HubCard` | One section card with icon, title, optional pill, actions cluster, optional meta strip, and arbitrary children. |
| `HubItems` | Vertical list of `HubItem`s with 4px gap. |
| `HubItem` | Single row: 36px hash-coloured letter avatar + title row (title, tags, author) + optional description + optional path + actions cluster. Hover lifts to a soft fill + secondary border; `active` flag tints to `--ant-color-primary-bg`. |
| `HubTag` | Compact pill in six tones (`default / primary / success / warning / danger / purple`); optional `mono` font. |
| `HubDot` | 6px status dot (`on / warn / off`). |
| `HubEmpty` | Dashed-border empty state. |
| `avatarColorFor` | Deterministic hash → palette colour. |

Sibling pieces — tab pills (`.app-hub-tabs`, `.app-hub-tab`) live in
`src/components/ExtensionsPanel/index.css` and are imported once via
`HubCard/index.tsx`. Forms inside hub drawers reuse plain AntD `Form`,
`Input`, `Select`, `Drawer` — no custom form widgets.

## 5. AntD interop rules

Use AntD components as-is for behaviour: `Modal`, `Drawer`, `Form`,
`Input`, `Select`, `Switch`, `Button`, `Empty`, `Spin`, `Popconfirm`,
`message`. Do **not** wrap them. Compose `HubCard`/`HubItem` for visual
structure inside the AntD modal body.

## 6. Where each surface lives

```
src/components/
  HubCard/                           ← shared primitives + CSS
  ExtensionsPanel/                   ← `extensions_*` Tauri commands
  McpCatalogPanel/                   ← `mcp_*` Tauri commands (new neutral)
  ClaudeConfigDirPanel/AgentRegistrySection.tsx
                                     ← `agent_registry_*` Tauri commands (Codex)
  SkillsHub/                         ← skills three-tier (already shipped)
```

Each panel mounts inside `AppSettingsModal` as an independent tab; the
modal already owns chrome (left nav 204px, top back button, right pane).

## 7. Acceptance (this task)

- [x] `HubCard` + `HubItems` + `HubItem` + `HubTag` + `HubDot` + `HubEmpty`
      shipped under `src/components/HubCard/`.
- [x] `ExtensionsPanel` consumes them and is wired into
      `AppSettingsModal` as the `extensions` tab; lists, toggles, and
      reloads against the live `extensions_*` commands.
- [x] `McpCatalogPanel` consumes them and is wired in as the `mcp` tab;
      list / save / delete / test against the live `mcp_*` commands;
      transport-aware drawer with stdio + remote variants and inline
      test result panel surfacing OAuth challenges.
- [x] `AgentRegistrySection` (Codex's component) is mounted as the
      `agents` tab and continues to render unchanged inside
      `ClaudeConfigDirPanel`.
- [x] `bunx tsc --noEmit` clean.
- [x] No hex literal in `HubCard/index.css` outside the avatar palette
      and the purple tone (purple has no AntD variable yet).
- [x] AntD CSS variables drive every surface — dark theme works the
      moment the runtime flips `algorithm`.

## 8. Out of scope

- Replacing the existing `ClaudeMcpConfigPanel` — the new neutral
  catalogue coexists.
- A standalone `<AgentSwitchCard>` for in-conversation engine switch
  (deferred until active-agent state machine exists).
- Skills Hub re-themed in HubCard idiom — current `SkillsHub.tsx` is
  functional; visual harmonisation is a follow-up.
- Light-only; dark theme inherits but is not visually audited.

## 9. Notes

- The earlier `EditorialUI/` plan + `tokens.css` + Fraunces/Switzer is
  **abandoned**. The static `preview.html` under
  `.trellis/tasks/05-17-ui-editorial-integration/preview.html` is the
  reference for the AntD-aligned direction.
- `examples/wise-extensions/hello-world` provides a real fixture for
  the Extensions panel; drop it under `~/.wise/extensions/` (or set
  `WISE_EXTENSIONS_PATH` to the examples dir) to see the panel
  populate.
