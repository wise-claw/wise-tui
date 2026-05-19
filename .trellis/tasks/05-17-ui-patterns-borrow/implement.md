# Implement — UI patterns borrow set

Top-to-bottom checklist. Each step lists pre-reads, the edit, and a gate.

## Step 0 · Re-baseline (done in design)

Already surveyed:
- `src/components/ClaudeConfigDirPanel/index.tsx` — 236 lines, single component.
- `src/components/AppSettingsModal/index.tsx` — only consumer of the panel.
- `src/components/MainLayoutResizeHandle/index.tsx` — drag-delta primitive,
  no snap logic; new hook stays independent.
- `src/services/atMentionDispatch.test.ts` — confirms `bun:test` runner.

## Step 1 · Settings view primitive

- [ ] Create `src/components/SettingsView/settingsViewContext.tsx`
      (Context + provider + `useSettingsViewMode` that throws when missing).
- [ ] Create `src/components/SettingsView/SettingsPageWrapper.tsx` (thin
      wrapper for `'page'` mode; modal mode renders children flat).
- [ ] Create `src/components/SettingsView/index.ts` re-export barrel.
- [ ] Create `src/components/SettingsView/settingsViewContext.test.tsx`
      — two tests: throws outside provider; returns value inside.

Gate: `bunx tsc --noEmit` clean for the new files.

## Step 2 · Sider drag snap hook

- [ ] Create `src/hooks/useSiderDragSnap.ts` exposing both:
  - Pure helper `applySiderDragSnap(prev, delta, opts)`.
  - React hook `useSiderDragSnap(opts)`.
- [ ] Create `src/hooks/useSiderDragSnap.test.ts` — drives the pure helper
      through the scripted sequences in design §4.

Gate: `bun test src/hooks/useSiderDragSnap.test.ts` passes.

## Step 3 · Refactor `ClaudeConfigDirPanel`

- [ ] Create `src/components/ClaudeConfigDirPanel/types.ts` with
      `ChoiceKey`, `InternalState`, `classifyRawValue`, `buildDirty`,
      `SENTINEL_INVALID` symbol used to signal "user picked custom but
      didn't fill the path."
- [ ] Create `src/components/ClaudeConfigDirPanel/useClaudeConfigDir.ts`:
  - Owns `info`, `loading`, `saving`, `aliveRef`.
  - Exposes `refresh()`, `save(value)`, `reset()`.
  - Toasts use `App.useApp().message` if available; otherwise the static
    `message` import (match current behavior — current file uses static
    `message` from antd, keep parity).
- [ ] Create `src/components/ClaudeConfigDirPanel/useClaudeConfigDirChoice.ts`:
  - Owns `state` (`InternalState`), `setChoice`, `setCustomDraft`,
    derived `dirty`, `resolveValueToSave()`.
  - Resets when `info` changes (mirrors current `useEffect` after refresh).
- [ ] Create `ClaudeConfigDirCurrent.tsx`, `ClaudeConfigDirChoiceList.tsx`,
      `ClaudeConfigDirActions.tsx` as render-only sub-components.
- [ ] Rewrite `index.tsx` as a thin container per design §3.3.
- [ ] Sanity diff: copy/paste comparison of pre/post strings — every Antd
      message string, every Tag color, every Alert child must be identical.
- [ ] Create `src/components/ClaudeConfigDirPanel/index.test.tsx`:
  - Module-mock `../../services/claudeConfigDir` returning a fixed
    `ClaudeUserConfigDirInfo`.
  - Render via `@testing-library/react` if available, else use a minimal
    `react-dom/client` mount; assert the panel mounts and the mocked
    fetcher was called once.
  - If `@testing-library/react` is **not** in `package.json`, drop the
    DOM-mount portion and keep a "hooks compose" test calling the hooks
    via `renderHook` from `@testing-library/react` if present, else from
    a minimal harness. The unit test must not require a new dependency.

Gate:
- `bun test src/components/ClaudeConfigDirPanel/index.test.tsx` passes.
- `bunx tsc --noEmit` clean.
- Manual diff (no dev server): grep for every original string in the new
  source to confirm preservation.

## Step 4 · Wire dual-mode provider at the call site

- [ ] Edit `src/components/AppSettingsModal/index.tsx`:
  - Wrap the `ClaudeConfigDirPanel` mount (around line 88) with
    `<SettingsViewModeProvider value="modal">…</SettingsViewModeProvider>`.
  - No other changes.

Gate: `bunx tsc --noEmit` clean. Visual: no behavior change in the modal.

## Step 5 · Spec entry

- [ ] Append the paragraph from design §5 to
      `.trellis/spec/frontend/index.md` under an appropriate existing
      section (or create a new "Reference patterns" subsection if none
      fits). Keep it one paragraph. No table rewrite.

Gate: file diff is one short addition, nothing else.

## Step 6 · Final verification

- [ ] `bun test src/hooks/useSiderDragSnap.test.ts`
- [ ] `bun test src/components/SettingsView`
- [ ] `bun test src/components/ClaudeConfigDirPanel`
- [ ] `bunx tsc --noEmit`
- [ ] `git status --short` — only the in-scope paths show up.
- [ ] Confirm `MainLayoutResizeHandle/` and `usePersistedMainLayoutSiderWidths.ts`
      were not modified.

Gate: all green.

## Rollback points

- After Step 1: delete `src/components/SettingsView/`.
- After Step 2: delete the two `useSiderDragSnap` files.
- After Step 3: `git checkout -- src/components/ClaudeConfigDirPanel/`.

## Notes

- All new tests use `bun:test`. No new dev deps.
- No emojis in source per project rule.
- English source; Chinese strings inside `ClaudeConfigDirPanel` are kept
  verbatim from the original file (they are user-facing copy).
