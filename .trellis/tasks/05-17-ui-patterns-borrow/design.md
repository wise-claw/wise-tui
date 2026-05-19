# Design — UI patterns borrow set

## 1. Boundaries

**In scope (write):**
- `src/components/SettingsView/settingsViewContext.tsx` (new)
- `src/components/SettingsView/SettingsPageWrapper.tsx` (new)
- `src/components/SettingsView/index.ts` (re-export barrel)
- `src/components/SettingsView/settingsViewContext.test.tsx` (new)
- `src/hooks/useSiderDragSnap.ts` (new)
- `src/hooks/useSiderDragSnap.test.ts` (new)
- `src/components/ClaudeConfigDirPanel/index.tsx` (refactor; behavior preserved)
- `src/components/ClaudeConfigDirPanel/types.ts` (new)
- `src/components/ClaudeConfigDirPanel/useClaudeConfigDir.ts` (new)
- `src/components/ClaudeConfigDirPanel/useClaudeConfigDirChoice.ts` (new)
- `src/components/ClaudeConfigDirPanel/ClaudeConfigDirChoiceList.tsx` (new)
- `src/components/ClaudeConfigDirPanel/ClaudeConfigDirCurrent.tsx` (new)
- `src/components/ClaudeConfigDirPanel/ClaudeConfigDirActions.tsx` (new)
- `src/components/ClaudeConfigDirPanel/index.test.tsx` (new — composition smoke)
- `src/components/AppSettingsModal/index.tsx` (one-line wrap with provider)
- `.trellis/spec/frontend/index.md` (additive entry naming the canonical pattern)

**In scope (read for orientation):**
- `AionUi-main/src/renderer/components/settings/SettingsModal/settingsViewContext.tsx`
- `AionUi-main/src/renderer/components/layout/Layout.tsx` lines 358-405
- `AionUi-main/src/renderer/pages/settings/ToolsSettings/McpManagement.tsx`

**Out of scope:**
- `MainLayoutResizeHandle/` — pure pointer-to-delta primitive; we add a
  separate hook that callers can layer on top, no change to the handle.
- `usePersistedMainLayoutSiderWidths.ts` — already persists widths; we do
  not touch storage.
- Any panel other than `ClaudeConfigDirPanel`.
- `LeftSidebar.tsx` / `Inspector/*` consumer rewiring.
- `localStorage` keys, route table, navigation.

## 2. Refactor target choice — why `ClaudeConfigDirPanel`

Surveyed candidates:

| Panel | LoC | Hooks-composition fit | Notes |
|---|---|---|---|
| `ClaudeConfigDirPanel` | 236 | ★★★★★ | Single component does fetch + classification + draft state + save + reset + refresh + render. Consumed by `AppSettingsModal` (modal context exists). |
| `ClaudeHooksConfigPanel.tsx` | 560 | ★★★ | Already partially decomposed under `ClaudeHooksConfigPanel/`. Refactoring further crosses too many boundaries for one task. |
| `EmployeeConfigModal/index.tsx` | 556 | ★★ | Modal-only; no dual-mode pairing. |
| `DingTalkEnterpriseBotPopoverBody.tsx` | 633 | ★★ | Large, but lives in popover not settings. |

`ClaudeConfigDirPanel` is the right size, has clean hook seams, and is
already mounted inside `AppSettingsModal` so the dual-mode provider has a
natural insertion point.

## 3. Three primitives

### 3.1 Settings view mode (`src/components/SettingsView/`)

```ts
// settingsViewContext.tsx
type SettingsViewMode = 'modal' | 'page';
const Ctx = React.createContext<SettingsViewMode | null>(null);

export function SettingsViewModeProvider({ value, children }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettingsViewMode(): SettingsViewMode {
  const v = useContext(Ctx);
  if (v == null) throw new Error('useSettingsViewMode must be used inside <SettingsViewModeProvider>');
  return v;
}
```

```tsx
// SettingsPageWrapper.tsx — used by the 'page' case only.
// Modal case wraps panels with no extra chrome.
export function SettingsPageWrapper({ title, children }) {
  return (
    <div className="settings-page-wrapper">
      <h1 className="settings-page-wrapper__title">{title}</h1>
      <div className="settings-page-wrapper__body">{children}</div>
    </div>
  );
}
```

No CSS module yet — inline styles or a sibling `.css` are fine. Consumers
that need both modes use `useSettingsViewMode()` to branch on
`mode === 'page'` for breadcrumbs/headers, otherwise render flat.

The `'page'` mode has **no current consumer** in wise. The wrapper exists
so that when a route-based settings surface is added later, the contract is
ready. We document this explicitly in the spec entry.

### 3.2 Sider drag snap (`src/hooks/useSiderDragSnap.ts`)

```ts
type SnapState = { width: number; collapsed: boolean };

interface UseSiderDragSnapOptions {
  expandedWidth: number;
  collapsedWidth: number;
  hysteresisPx?: number;       // default 6
  initial: SnapState;
  onChange: (next: SnapState) => void;
}

interface UseSiderDragSnapResult {
  state: SnapState;
  onPointerDelta: (deltaPx: number) => void;
  reset: (next: SnapState) => void;
}
```

Algorithm:

- Pure function `applyDrag(prev: SnapState, deltaPx: number, opts) => SnapState`:
  - Compute `proposed = prev.width + deltaPx`.
  - Compute `snap = (expandedWidth + collapsedWidth) / 2`.
  - Hysteresis band = `[snap - h, snap + h]`.
  - If `prev.collapsed` and `proposed > snap + h` → `{ width: expandedWidth, collapsed: false }`.
  - If `!prev.collapsed` and `proposed < snap - h` → `{ width: collapsedWidth, collapsed: true }`.
  - Otherwise stay in current mode and clamp `width` to
    `[collapsedWidth, expandedWidth]`.
- Exported as both the hook **and** a pure helper
  `applySiderDragSnap(prev, delta, opts)` so the unit test can drive the
  algorithm without React.

The hook holds `state` in a `useState`, exposes `onPointerDelta` (which
updates state and fires `onChange`), and `reset` for external sync.

The hook is purely additive. `MainLayoutResizeHandle` continues working
unchanged. Future surfaces (e.g., a collapsible Inspector that should snap
to fully closed) can opt in.

### 3.3 Hook-composition refactor of `ClaudeConfigDirPanel`

Decomposition:

```
ClaudeConfigDirPanel/
  index.tsx                          ← container; only assembles + renders
  types.ts                           ← ChoiceKey, InternalState, helpers
  useClaudeConfigDir.ts              ← fetch + save + reset + refresh
  useClaudeConfigDirChoice.ts        ← draft state (choice + customDraft)
  ClaudeConfigDirCurrent.tsx         ← "当前生效" panel
  ClaudeConfigDirChoiceList.tsx      ← Radio group
  ClaudeConfigDirActions.tsx         ← 保存 / 恢复默认 / 重新检测 buttons
  index.test.tsx                     ← composition smoke (with mocked invoke)
```

`useClaudeConfigDir(refreshOnMount = true)`:
- Returns `{ info, loading, saving, refresh(), save(rawValue: string | null), reset() }`.
- Owns `aliveRef` and surface error toasts via Antd `message` exactly as today.
- Uses `getClaudeUserConfigDir` / `setClaudeUserConfigDir` from the existing
  service; **no service-layer change**.

`useClaudeConfigDirChoice(info: Info | null)`:
- Returns `{ state, setChoice(next), setCustomDraft(next), reset(info), dirty, resolveValueToSave() }`.
- Pure derivation around the existing `classifyRawValue`, `buildDirty`
  helpers (kept in `types.ts`).

`index.tsx` becomes a thin container:

```tsx
export function ClaudeConfigDirPanel() {
  const { info, loading, saving, refresh, save, reset: resetEffective } = useClaudeConfigDir();
  const choice = useClaudeConfigDirChoice(info);
  const handleSave = useCallback(async () => {
    const value = choice.resolveValueToSave();
    if (value === SENTINEL_INVALID) { message.warning('请填写自定义路径，或选择上方预设。'); return; }
    await save(value);
  }, [choice, save]);
  // … early returns for loading / null ...
  return (
    <div className="app-claude-config-dir-panel">
      <Typography.Paragraph …>…</Typography.Paragraph>
      <ClaudeConfigDirCurrent info={info} />
      <ClaudeConfigDirChoiceList state={choice.state} onChoiceChange={choice.setChoice} onCustomDraftChange={choice.setCustomDraft} onSubmit={handleSave} />
      <Alert … />
      <ClaudeConfigDirActions saving={saving} dirty={choice.dirty} canReset={!info.isDefault} onSave={handleSave} onReset={resetEffective} onRefresh={refresh} />
    </div>
  );
}
```

Behavior preserved:
- Same fetch on mount via `aliveRef`.
- Same Antd `message.success / error / warning` strings.
- Same Tag colors, same Alert content, same Radio options.
- Same form interaction (`onPressEnter` on the custom-path input still
  triggers save).

User-visible diff: zero.

## 4. Verification

- `bun test src/hooks/useSiderDragSnap.test.ts` — drives the pure
  `applySiderDragSnap` through scripted deltas:
  - From expanded, drag inward by `(expanded-collapsed)/2 - 5px` → stays
    expanded (within hysteresis band).
  - Drag inward by `(expanded-collapsed)/2 + 10px` → snaps to collapsed.
  - From collapsed, drag outward by `(expanded-collapsed)/2 + 10px` →
    snaps to expanded.
  - From collapsed, jiggle around the midpoint within `±5px` → never flips.
- `bun test src/components/SettingsView/settingsViewContext.test.tsx`:
  - `useSettingsViewMode` outside provider throws.
  - Inside provider returns the right mode.
- `bun test src/components/ClaudeConfigDirPanel/index.test.tsx`:
  - With `services/claudeConfigDir` mocked at module level, the container
    renders without crashing, calls `getClaudeUserConfigDir` once on
    mount, and the Save button reflects `dirty` state when the choice
    changes.
- `bunx tsc --noEmit` clean.

Existing test file `src/services/atMentionDispatch.test.ts` confirms the
runner is `bun:test`. New tests use the same import.

## 5. Spec entry

Append a row or section to `.trellis/spec/frontend/index.md`:

> **Hook-composition container pattern** — see
> `src/components/ClaudeConfigDirPanel/`. A panel that fetches data,
> derives state, and renders interaction should split fetch/derive/render
> into hooks (`useClaudeConfigDir`, `useClaudeConfigDirChoice`) consumed
> by a flat container. Settings panels intended for both modal and route
> use also wrap their entry with `<SettingsViewModeProvider>` from
> `src/components/SettingsView/`.

One paragraph; no full doc.

## 6. Risk register

| Risk | Mitigation |
|---|---|
| Behavior regression in Claude Config Dir flow | Refactor preserves call order, same toast strings, same `aliveRef` semantics. Snapshot via the composition smoke test. |
| New test runner mismatch (vitest vs bun:test) | All new tests use `bun:test` to match `src/services/atMentionDispatch.test.ts`. |
| Future page-mode ambiguity | `useSettingsViewMode()` throws on missing provider, forcing call-site discipline. `'page'` wrapper exists but has no current consumer; the spec entry says so. |
| Hysteresis hook integrating accidentally | Hook is purely additive; not wired into `MainLayoutResizeHandle`. The `useSiderDragSnap` test exercises the algorithm only. |
| Filename / casing collisions on macOS | All new filenames are unique within their dirs. |

## 7. Compatibility / rollback

- Pure additive in code surface; one panel internally restructured, public
  export `ClaudeConfigDirPanel` unchanged.
- Rollback: `git checkout -- src/components/ClaudeConfigDirPanel
  src/components/SettingsView src/hooks/useSiderDragSnap.* src/components/AppSettingsModal/index.tsx
  .trellis/spec/frontend/index.md`.

## 8. Open questions

None.
