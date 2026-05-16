# P2 Mission Evidence Replay and Onboarding Health — Implementation

## Completed

- Added `mission_evidence` persistence in migration `021_mission_control_planning_evidence.sql`.
- Added Tauri commands:
  - `mission_record_evidence`
  - `mission_capture_git_evidence`
  - `mission_list_evidence`
  - `mission_get_replay`
  - `mission_get_onboarding_health`
- Added typed frontend wrappers in `src/services/missionControlBackend.ts`.
- Added service wrapper coverage for evidence, replay, and onboarding health.

## Validation

- `cargo test --lib`
- `bun test src/components/MissionControl src/components/PrdSplitWizard src/services/missionControlBackend.test.ts`
- `bunx tsc --noEmit --pretty false`

## Notes

Evidence capture is best-effort and independent of Mission completion. A failed optional evidence capture should be recorded as an evidence warning by callers rather than blocking the whole Mission.
