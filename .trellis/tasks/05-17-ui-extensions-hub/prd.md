# Extensions Hub UI

## Goal

Ship the first feature surface in the editorial design language: a
single-page Extensions Hub that lists installed extensions, surfaces
update availability, exposes per-extension enable / reload / open-dir
actions, and shows the contributes (skills / themes / settings) each
extension provides. Hosted inside `AppSettingsModal` as a new tab and
reusable in route mode via the existing `SettingsViewModeProvider`.

## Background

`extensions_list / extensions_get_skills / extensions_get_themes /
extensions_get_settings_declarations / extensions_set_enabled /
extensions_get_permissions / extensions_reload` are already wired
end-to-end from `src-tauri/src/extensions/` (Task 3). There is no UI
for any of them today.

The visual reference is `.trellis/tasks/05-17-ui-editorial-integration/
preview.html` — specifically the upper half (header through the editorial
rows). All primitives in §7 of the design system are exercised in this
surface, which is why it lands first.

## Requirements

### R1 — Component placement

```
src/components/ExtensionsHub/
  ExtensionsHub.tsx              ← top-level container
  ExtensionsHub.module.css       ← variable references only, no literals
  hooks/
    useExtensionsList.ts         ← listExtensions + reload + setEnabled
    useExtensionRowSelection.ts  ← which row is selected for detail
  rows/
    ExtensionRow.tsx             ← renders <EditorialRow> with row data
    ExtensionDetailPane.tsx      ← right-side detail when a row is selected
  ExtensionsHubEmpty.tsx         ← <EmptyOpening> variant
```

### R2 — Service wrapper consolidation

`src/services/extensions.ts` already exists; add only:

- `useExtensionsHubModel()` — combines list + skills + themes + settings
  into one denormalized view per extension. Memoized.
- A shared `formatRelativeTime(iso)` helper or import from existing
  utility.

### R3 — Layout (matches preview.html lines 1–360)

Page header:
- Eyebrow: `WISE · 扩展目录 · NO. 01`
- Section title: `On the matter of extensions` (italic on "extensions").
- Lede: 2-line italic prose explaining the catalog.

Stats strip (4 columns via `<MetaPair>`):
- Installed count
- Updates count (oxblood when > 0)
- Disabled count
- Last reload timestamp (mono-m, with date superscript)

Tabs (`<HairlineTabs>`):
- Installed (default)
- Disabled
- All

Search input with ⌘K hint, hairline border, oxblood focus.

Editorial rows (one `<ExtensionRow>` per extension):
- Index `01`, `02`, … in mono-s margin numerals.
- Title: extension name; italicizes to Fraunces on hover.
- Author / contribute summary inline after the title with a bullet.
- Description in body-m ink-2 → ink-1 on hover.
- Contributes badges (`skill · 1`, `theme · 1`, `setting · 1`) using
  `<ed-tag>`; oxblood-tinted variant for permission-flagged contributes
  (e.g. requires-fs).
- Right cluster: `update` pill (oxblood) when an update is available;
  status dot (sage / mustard / ink-3); version (mono-m).
- Hover: left bar widens to 3px in oxblood, row bg → paper-deep.

Toolbar at bottom of list:
- Ghost: `Reload all` → `extensions_reload`.
- Ghost (accent): `Update N` → enabled only when updates > 0.
- Ghost: `Open extensions dir` → `tauri-plugin-opener` to
  `~/.wise/extensions/`.
- Ink primary: `Install from path…` → opens an AntD `Modal` with a
  directory picker that copies the chosen dir into
  `~/.wise/extensions/` and triggers a reload.

Detail pane (replaces stats strip when a row is selected):
- Slides from right into a 360px panel inside the modal.
- Shows manifest metadata (version, apiVersion, engines, dependencies),
  full description, permissions list as a `MetaPair` grid, contributes
  list with file paths (mono-m).
- "Disable" / "Enable" ghost button.
- "Open in editor" ghost button (opens manifest path).

### R4 — Empty + error states

- Empty: `<EmptyOpening>` with cap `N` followed by italic prose:
  *"o extensions are installed yet. Drop a manifest folder under
  `~/.wise/extensions/` or pick one from disk."*
- Error: an inline `<Alert type="error">` styled with the editorial
  border treatment (1px rule, no shadow, no fill).

### R5 — Routing into AppSettingsModal

- Extend `AppSettingsModalTab` union with `"extensions"`.
- Add the new tab between `claudeConfigDir` and `dingtalk`.
- Extension hub mounts inside the same scroll pane structure.
- The tab pane wraps the hub with `<SettingsViewModeProvider value="modal">`.

### R6 — Tests

- `useExtensionsHubModel.test.ts` — given mocked invokes, returns
  denormalized rows with correct contribute counts.
- `ExtensionRow.test.tsx` — renders title / version / status dot /
  update pill correctly under each combination.
- `ExtensionsHub.integration.test.tsx` — mock `invoke`; mount the
  full hub; assert that toggling `enabled` on a row calls
  `extensions_set_enabled` with the right payload.

### R7 — Preview update

- Append the implemented rows to
  `.trellis/tasks/05-17-ui-editorial-integration/preview.html` in a
  section labeled "implemented" so reviewers can compare static
  preview ↔ React output side by side.

## Constraints

- Editorial primitives only — no AntD `Card`, `List`, or `Tag` direct
  use inside the hub (those are not editorial).
- AntD `Modal` for "Install from path…" is allowed (modal chrome is
  AntD's domain). Inside the modal body, primitives apply.
- No new dependency.
- All copy stays Chinese where it's user-facing prose. The eyebrow
  and decorative English ("On the matter of extensions") is treated
  as title typography and stays English by design — analogous to a
  magazine masthead. If the user wants Chinese eyebrows, add a setting
  for it in a follow-up task; out of scope here.
- No raw HTML interactive elements (no `<button>` outside primitives).

## Acceptance Criteria

- [ ] `bun test src/components/ExtensionsHub` passes.
- [ ] `bunx tsc --noEmit` clean.
- [ ] Mounting `<ExtensionsHub />` against the live Tauri commands
      lists every extension under `~/.wise/extensions/` plus the
      bundled `examples/wise-extensions/hello-world` when
      `WISE_EXTENSIONS_PATH` includes it.
- [ ] Toggling enable/disable round-trips through
      `extensions_set_enabled` and updates the row indicator within
      the same render frame.
- [ ] `Reload all` button calls `extensions_reload` and re-renders
      the list with the entry choreography replayed.
- [ ] No `Inter`, `Roboto`, or `Arial` strings in the new module.
- [ ] No literal hex color or raw size in the module CSS — all values
      reference `tokens.css` variables.
- [ ] Lighthouse contrast audit on the modal at 1280×800 returns no
      failures.

## Out of Scope

- Install-from-URL / install-from-zip (manifest dir copy only).
- Marketplace / hub remote index.
- Extension settings declaration form rendering inside the hub
  (declarations are listed but their widgets remain in their
  contributing extension's tab — out of scope for v1).
- Drag-and-drop install.

## Notes

- The hub is the **first** feature surface to land. It validates every
  primitive in real production code; subsequent tasks cite it as the
  reference implementation.
