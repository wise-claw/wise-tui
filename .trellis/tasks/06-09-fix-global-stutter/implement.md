# Implementation Plan

1. Load relevant frontend and guide specs before editing.
2. Inspect `LeftSidebar`, `useMonitorSessionsForOverview`, `useSidebarWorkspaceTodoCounts`, and existing tests.
3. Remove duplicate periodic fingerprint work in `LeftSidebar` by deriving one shared fingerprint for the shared `sessions` input and only deriving a separate monitor-panel fingerprint when its input differs.
4. Optimize `monitorSessionsTerminalStatusFingerprint` so running/connecting sessions do not scan assistant messages for a settled preview bucket.
5. Verify Todo count hook remains event/scope driven and does not introduce a fixed multi-second refresh loop.
6. Update focused tests for fingerprint behavior and run targeted Bun tests.
7. Run Trellis check before finishing.

## Validation Commands

- `bun test src/hooks/useMonitorSessionsForOverview.test.ts`

## Risky Files / Rollback Points

- `src/hooks/useMonitorSessionsForOverview.ts`: fingerprint semantics; rollback if monitor overview stops updating on session status/message boundary changes.
- `src/components/LeftSidebar.tsx`: memo keys for sidebar slots; rollback if monitor/transcript panel remounting becomes stale.
- `src/hooks/useSidebarWorkspaceTodoCounts.ts`: inspect only unless evidence requires change.
