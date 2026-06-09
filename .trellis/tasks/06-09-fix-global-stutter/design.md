# Design

## Likely Root Cause

The strongest candidate is the monitor session fingerprint path. `LeftSidebar` creates two `useMonitorSessionsFingerprint` instances for the same frequently changing `sessions` source. Each instance schedules a recurring idle callback every `MONITOR_SESSIONS_SYNC_INTERVAL_MS`. The callback computes `monitorSessionsTerminalStatusFingerprint`, which iterates sessions and message metadata on the main thread. With enough active or historical messages, the work can surface as a visible periodic stutter.

Workspace Todo count loading is a secondary candidate because it may batch project/repository reads, but it runs on scope changes or events rather than a fixed multi-second cadence.

## Boundaries

- Keep changes in frontend hook/component code and tests.
- Do not change backend persistence or Tauri IPC unless evidence later points there.
- Preserve existing monitor panel semantics: status and terminal/overview-visible state changes still propagate.

## Data Flow

`App` / session state updates `sessions` frequently during Claude streaming. `LeftSidebar` derives memo keys from monitor fingerprints. `useMonitorSessionsForOverview` provides a throttled sessions list to monitor overview. The fix should ensure expensive derivation happens at most once for the shared `sessions` list and only when structural monitor fields change.

## Approach

- Replace duplicate sidebar fingerprint hooks with a single shared fingerprint for `sessions`; reuse it for transcript and monitor panel when both inputs are the same.
- Make fingerprint computation cheaper for running/connecting sessions by avoiding assistant preview scans where the result is intentionally ignored.
- Keep settled-session preview bucketing only for non-running sessions where the preview length may affect display.
- Ensure interval callbacks are not created when the relevant monitor panel feature is disabled.
- Review Todo count hook for accidental periodic refresh; keep event-driven behavior.

## Compatibility

The public exported functions remain available. Existing tests using `monitorSessionsOverviewFingerprint` should keep working. UI behavior should only become less eager during streaming, not less correct for structural session changes.

## Rollback

If the optimization hides a required monitor update, revert the affected hook change and narrow the fingerprint fields via tests before reapplying.