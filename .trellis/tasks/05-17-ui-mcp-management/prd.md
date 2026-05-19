# MCP server management UI (neutral)

## Goal

Ship a first-class UI for the new neutral `mcp_*` Tauri command surface
(Task 2): a single catalog of MCP servers stored in wise's own
`mcp_server` table, decoupled from any specific engine. Users add /
edit / delete servers here, test their transports, and (in a later
task) sync them to whichever AI engines they target. Distinct from the
existing Claude-bound `ClaudeMcpConfigPanel`; the two coexist.

## Background

Task 2 shipped a backend-neutral MCP layer:
- `mcp_list_servers / mcp_save_server / mcp_delete_server /
  mcp_test_connection / mcp_supported_transports`
- A `mcp_server` table keyed by `(name, source)` with a tagged
  `McpTransport` JSON column covering `stdio | sse | http |
  streamable_http`.
- `src/services/mcp.ts` wrappers + tests already in place.

Today the only UI for MCP servers is `ClaudeMcpConfigPanel.tsx`, which
talks to Claude's config files directly. The neutral catalog has no UI.

## Requirements

### R1 — Component placement

```
src/components/McpCatalog/
  McpCatalog.tsx                  ← editorial top-level surface
  McpCatalog.module.css           ← tokens references only
  hooks/
    useMcpCatalog.ts              ← list + crud + test
    useMcpTransportEditor.ts      ← controlled form for the four transports
  rows/
    McpServerRow.tsx              ← editorial row variant
  forms/
    TransportFields.tsx           ← stdio / sse / http / streamable_http
    EnvKeyValueEditor.tsx         ← header / env table
  McpTestResult.tsx               ← shows the McpConnectionTestResult
  McpServerDrawer.tsx             ← AntD Drawer with editorial body
```

### R2 — Top-level layout

Header:
- Eyebrow: `WISE · MCP 目录 · NO. 03`.
- Section title: `On serving *context*` (italic on "context").
- Lede: italic prose — explains this catalog is engine-neutral, that
  server records here can later be synced to specific engines, and
  that Claude's existing MCP config remains untouched.

Stats strip (4 columns):
- Total servers
- Stdio count
- HTTP / SSE count
- Disabled count

Tabs (`<HairlineTabs>`):
- "全部"
- "User"
- "Builtin"
- "Extension"
  
The fourth tab is empty until extension-contributed MCP servers ship
in a follow-up task; render an `<EmptyOpening>` there.

### R3 — Editorial rows

`<McpServerRow>` per server:
- Index in mono-s.
- Title: server `name`; italicizes on hover.
- Author / source line: `User · stdio` / `Builtin` / `Extension ·
  hello-world` rendered in body-m ink-3.
- Description: derived from transport — for stdio, `command + args[0]`;
  for http variants, the URL; truncated to 60 chars in mono-m.
- Right cluster: enabled status dot (sage / ink-3), transport tag
  (mono-m, e.g. `stdio`, `http`, `streamable_http`), version-style
  badge if `needsAuth` was last seen on this server.
- Hover reveals `测试连接` / `编辑` ghost buttons.

### R4 — Add / edit drawer

Triggered from a single InkButton in the toolbar (`新增 MCP 服务器`).

Drawer body (350px, AntD `Drawer` with editorial overrides):
- Eyebrow `编辑 · MCP 服务器`.
- Section title showing the current name (or "未命名" for new).
- Form fields:
  - Name (required, `[a-zA-Z0-9._-]+`).
  - Transport type (segmented: `stdio` / `sse` / `http` /
    `streamable_http`).
  - Transport-specific fields rendered by `TransportFields`.
  - Env / headers via `EnvKeyValueEditor`.
  - Source select (User / Extension:slug — Extension is read-only
    when editing an extension-source row).
  - Enabled switch.
- Footer ghost actions: `测试连接`, `保存`, `删除` (when editing).
- Test result panel inline below the form, showing
  `McpConnectionTestResult`:
  - `ok` → sage dot + "连接成功" + tools list (mono-m).
  - `needsAuth` → mustard dot + "需要登录" + parsed `authMethod`.
  - failure → ink-3 dot + error string in mono-m.

### R5 — Toolbar

Bottom of list:
- Ghost `刷新` → `mcp_list_servers`.
- Ghost (accent) `测试全部` → iterates `mcp_test_connection` for each
  enabled server with a single in-flight cap of 4.
- Ink primary `新增` → opens the drawer in create mode.

### R6 — Surface mounting

Add an `mcp` tab to `AppSettingsModal` between `dingtalk` and
`shortcuts`. Localized label: "MCP 服务器".

The existing `ClaudeMcpConfigPanel` stays where it is (under the
ClaudeCodeToolsPanel). A small inline link in the new MCP catalog
header reads "Claude 自有 MCP 配置 →" and opens the legacy panel,
making the relationship explicit.

### R7 — Tests

- `useMcpCatalog.test.ts` — list / save / delete round trip with mocked
  invoke.
- `useMcpTransportEditor.test.ts` — toggling between transports
  preserves common fields (name, env) and clears irrelevant ones.
- `McpServerRow.test.tsx` — renders correct transport tag and source
  badge for each combination.
- `TransportFields.test.tsx` — required-field validation per transport.

### R8 — Preview update

Append an MCP catalog section to `preview.html` with three editorial
rows (one stdio, one http, one streamable_http) and a static drawer
mockup.

## Constraints

- The neutral catalog **does not** read or write Claude's MCP config
  files. Cross-engine sync is a follow-up.
- `mcp_test_connection` v1 is structural-only (Task 2 §10 design
  notes). The UI must therefore label "测试连接" honestly: the result
  panel includes a small italic note "结构校验 · 实际探测在后续版本"
  for now. When real probing lands, the note is removed.
- AntD `Drawer` allowed; body content uses editorial primitives only.
- No new runtime dependency.

## Acceptance Criteria

- [ ] `bun test src/components/McpCatalog` passes.
- [ ] `bunx tsc --noEmit` clean.
- [ ] Adding, editing, and deleting an MCP server round-trips through
      Tauri and persists across restart.
- [ ] Each transport's required fields validate before save.
- [ ] Test-connection panel surfaces `needsAuth` / `authMethod` when
      a synthetic OAuth-required result is returned.
- [ ] No `Inter`, `Roboto`, or `Arial` in the new module.
- [ ] No literal hex / size in the module CSS.

## Out of Scope

- Cross-engine sync (`mcp_sync_to_engines`) UI.
- OAuth login flow (only the hint surfaces).
- Real socket-level connection probing (Task 2 §11 follow-up).
- Migration of existing Claude config servers into the neutral
  catalog (Task 2 §10 follow-up).
- Extension-contributed MCP servers (extension task §Out of Scope).

## Notes

- The "全部 / User / Builtin / Extension" tab order mirrors the
  Skills Hub source ordering so users learn one provenance pattern
  across surfaces.
