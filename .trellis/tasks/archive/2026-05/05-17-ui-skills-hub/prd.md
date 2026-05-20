# Skills Hub full UI

## Goal

Replace the temporary external-browse stub shipped in Task 4 with a
production-grade Skills Hub built on the editorial primitives. Surface
all three skill sources (`builtin`, `custom`, `extension`) in a single
unified view, support search across all of them, and integrate the
external-path browse / import flow as a peer of the existing skills.sh
registry search.

## Background

`SkillsHub.tsx` today does two things:

1. Searches the public skills.sh registry and installs into Claude.
2. (Recently added stub) Browses external paths and imports via copy /
   symlink into `~/.wise/skills/`.

The stub was deliberately crude — Segmented control plus an unstyled
list. This task rewrites the surface end-to-end on top of the editorial
design system. The skills.sh registry behavior is preserved but
restructured into the same editorial rhythm.

## Requirements

### R1 — Component placement

```
src/components/SkillsHub/
  SkillsHub.tsx                  ← thin container, composes the panes
  SkillsHub.module.css           ← references tokens.css only
  hooks/
    useSkillsCatalog.ts          ← merged source-tagged list (custom + builtin + extension)
    useExternalBrowse.ts         ← detect paths, scan, import
    useSkillsRegistrySearch.ts   ← skills.sh search + install (existing logic relocated)
  panes/
    SkillsByProvenance.tsx       ← editorial list grouped by source
    SkillsRegistrySearch.tsx     ← skills.sh registry search list
    SkillsExternalBrowse.tsx     ← external path browser
  rows/
    SkillRow.tsx                 ← <EditorialRow> wrapper
    ExternalPathRow.tsx          ← path picker row variant
```

### R2 — Top-level layout

Header:
- Eyebrow: `WISE · 技能库 · NO. 02`.
- Section title: `Skills, by *provenance*` (italic on "provenance",
  matches preview.html teaser at line 380+).
- Lede: 2-line italic prose explaining the three sources.

Stats strip (4 columns):
- Custom count (your skills, deletable)
- Builtin count (shipped by Claude / wise — read-only)
- Extension count (contributed; removing the extension removes the skill)
- Total

Tabs (`<HairlineTabs>`):
- "我的" (custom + builtin merged view, default)
- "扩展贡献" (extension-source skills, read-only)
- "skills.sh 注册表" (registry search; pulls existing behavior)
- "外部目录" (external-path browse + import)

### R3 — `SkillsByProvenance` pane (default)

Editorial rows (`<SkillRow>`), one per skill:
- Index `§01`, `§02`, … (the section-anchor variant of `<IndexMark>`).
- Title: skill name; italic on hover.
- Author / source line: `custom · symlink` / `claude plugin · cache` /
  `via {extensionId} · ext.` rendered in body-m ink-3.
- Description: from `SKILL.md` frontmatter (ink-2 → ink-1 on hover).
- Right cluster: source tag (`custom` plain / `builtin` plain /
  `extension` oxblood-tinted), then a chevron when row is interactive.

Per-row actions (revealed on hover, right-aligned ghost buttons):
- `Open` — opens the skill directory in the OS file browser.
- `Delete` — only for `custom`; opens AntD `Modal.confirm` styled
  editorially (paper bg, no shadow).

### R4 — `SkillsRegistrySearch` pane (skills.sh)

Reuses the existing `skillsShSearch` / `skillsCliAddFromRegistry` /
`skillsCliRemoveFromRegistry` services unchanged.

Restructured visuals:
- Same header / stats strip as the parent, but with eyebrow
  `WISE · 注册表搜索`.
- Search input is the editorial variant from preview.html.
- Result rows are `<SkillRow>` variants showing install count
  (mono-m) and source slug.
- Install scope (`project` / `global`) lives in a small pair of
  ghost buttons above the search row, labeled **当前仓库** /
  **全局**, with the active one underlined in oxblood.
- Install / uninstall actions are ghost buttons in the row's right
  cluster.

### R5 — `SkillsExternalBrowse` pane

Two-column layout inside the editorial column:

Left column (paths, 320px):
- Detected paths (default + persisted) rendered as `<ExternalPathRow>`.
- Each row: path in mono-m, count in mono-s, "默认" tag for
  built-in defaults, ghost `删除` for user-added entries.
- Below the list: an inline form for "Add path" — directory picker
  AntD button styled flat, plus a ghost `添加` to commit.

Right column (skills under selected path):
- Editorial rows for each scanned skill.
- Per-row actions: `复制` (Ink primary, small) and `链接` (ghost) and
  `从 wise 移除` (ghost-accent).

### R6 — Empty + error states

- All four panes have an `<EmptyOpening>` variant.
- Errors rendered as a single inline alert above the rows; no toast
  spam.

### R7 — Service layer additions

`src/services/skills.ts` already exposes the new commands. Add:

- `useSkillsCatalog()` — composes `listClaudeProjectSkills` /
  `listClaudeUserSkills` / `listClaudePluginCacheSkills` /
  `getExtensionSkills` (Task 3 command) into one source-tagged list.
- `useExternalBrowse()` — wraps `detectExternalSkillPaths` +
  `scanSkillPath` + `addExternalSkillPath` + `removeExternalSkillPath`.
- `useSkillsRegistrySearch()` — relocated from inline state in the
  current `SkillsHub.tsx`.

### R8 — Tests

- `useSkillsCatalog.test.ts` — given mocked invokes, merges three
  sources with no duplicate names within the same source.
- `useExternalBrowse.test.ts` — add → detect now includes the path;
  remove → path gone.
- `SkillRow.test.tsx` — source tag color matches.
- Existing `AuthorPanel.test.tsx` continues to pass (it stubs SkillsHub
  via `mock.module`, so internal restructure is transparent).

### R9 — Preview update

Append a Skills Hub section to `preview.html` showing one row per
source plus the external-browse two-column layout.

## Constraints

- Existing `skillsShSearch` / `skillsCliAddFromRegistry` /
  `skillsCliRemoveFromRegistry` Tauri commands unchanged.
- Existing `ProjectSkillsPanel.tsx` continues to use the existing
  `claude.ts` service — its UI is **out of scope** for this task.
  We're rewriting the Hub, not the per-project skill editor.
- Symlink import is Unix-only. Windows users see the plain "复制"
  button only with a tooltip explaining symlink unavailability.
- AntD `Modal.confirm` allowed for destructive confirmations only;
  it gets editorial body styling via the global override CSS.
- No new runtime dependency.

## Acceptance Criteria

- [ ] `bun test src/components/SkillsHub` passes.
- [ ] `bunx tsc --noEmit` clean.
- [ ] All four tabs render against the live Tauri commands without
      console errors.
- [ ] A skill imported via symlink shows `symlink` in its source line
      and survives a hub reload.
- [ ] Deleting a `custom` skill removes both the row and the on-disk
      directory or symlink.
- [ ] `builtin` and `extension` skills are surfaced but cannot be
      deleted via the hub UI (ghost button absent or disabled).
- [ ] `AuthorPanel.test.tsx` continues to pass.
- [ ] No `Inter`, `Roboto`, or `Arial` in the new module.

## Out of Scope

- Per-skill `SKILL.md` editor (lives in `ProjectSkillsPanel`).
- Skill validation / linting.
- Cross-source name collision rules (extension task owns this).
- Skill versioning / update prompts.

## Notes

- The Hub is mounted from two places today: `AppWorkspaceLayout`
  overlay and `AuthorPanel`. Both continue to work because the
  external `<SkillsHub />` API surface (props) is unchanged.
- The skills.sh `installScope` toggle moves out of the header and
  into the registry-search pane only — it doesn't make sense in the
  other tabs.
