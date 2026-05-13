# Reduce Repository File Open Latency

## Goal

Reduce the perceived latency when opening and editing repository files by moving
repository file editor state out of `AppImpl` and into a layout-scoped host,
so high-frequency editor updates do not force the sidebar, session shell, and
right panel to reconcile on every tab/content change.

## What I already know

- `useRepositoryFileEditor` previously lived at the top app-shell level and
  fed editor props downward through `AppImpl`.
- Repository file open actions originate from multiple surfaces:
  `LeftSidebar` file explorer, `RightPanel` Git panel, and session-adjacent UI.
- `AppWorkspaceLayout` is the natural shared owner for editor UI because it
  already composes the sidebar, sessions area, right panel, preview modal, and
  command palette.
- Current worktree changes already introduce a layout-level open-file context
  and editor-panel context that can absorb the editor state without changing
  repository/session routing semantics.

## Assumptions

- The task should preserve current file-opening behavior from sidebar and Git
  surfaces.
- Multi-repo / project-rooted session routing should remain unchanged; this is a
  rendering-boundary fix, not a session-anchor redesign.
- Hiding the chat message area while the repository editor is open is acceptable
  because the current UX already treats the editor as the primary work surface.

## Requirements

- Move repository file editor state ownership from `AppImpl` into a bounded
  layout-level host.
- Keep a stable `openRepositoryFile(path, options?)` entry point available to
  `LeftSidebar` and `RightPanel`.
- Prevent editor tab/content churn from triggering top-level app-shell renders.
- Preserve repository binary preview behavior and save/diff flows.
- Keep TypeScript/build/test green after the refactor.

## Acceptance Criteria

- [x] Opening a file from the left sidebar still opens the built-in editor.
- [x] Opening a file or diff from the right Git panel still opens the built-in editor.
- [x] `AppImpl` no longer owns repository file editor state.
- [x] The editor state is hosted inside `AppWorkspaceLayout` via local context.
- [x] `bun test`, `bun run tsc --noEmit`, and `bun run build` pass.

## Out of Scope

- Rewriting Monaco integration.
- Changing repository session anchor rules.
- Reworking unrelated floating-repository or role-tag features.

## Technical Notes

- Main files:
  - `src/AppImpl.tsx`
  - `src/components/AppWorkspaceLayout.tsx`
  - `src/components/ClaudeSessions/index.tsx`
  - `src/components/ClaudeSessions/ClaudeChat.tsx`
  - `src/components/LeftSidebar.tsx`
  - `src/components/RightPanel.tsx`
  - `src/hooks/useRepositoryFileEditor.ts`
- The layout-scoped host uses:
  - an open-file context for cross-panel entry points
  - a panel context for editor/preview rendering state
  - memoized connected wrappers to minimize subtree churn
