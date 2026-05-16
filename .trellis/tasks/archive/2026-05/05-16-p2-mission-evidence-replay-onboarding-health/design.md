# P2 Mission Evidence Replay and Onboarding Health — Design

## 1. Boundary

This task adds backend contracts for proof and onboarding. It does not build the timeline UI or health panel UI.

Data flow:

```text
Mission execution / future UI
  -> src/services/missionControlBackend.ts
  -> src-tauri/src/mission_control.rs
  -> mission_evidence + mission_events
  -> replay / health query DTOs
```

## 2. Evidence Storage

Evidence is additive and typed:

- `missionId`
- `taskId`
- `requirementId`
- `clusterId`
- `agentRunId`
- `repositoryPath`
- `evidenceType`
- `status`
- `summary`
- JSON payload

This supports git status, test results, command output excerpts, commits, PR links, screenshots, and spec update metadata without locking the schema too early.

## 3. Git Evidence

`mission_capture_git_evidence` validates the repository path as an existing absolute directory, opens it with `git2`, and stores changed-file status. It does not run shell commands and does not read secrets.

## 4. Replay

`mission_get_replay` merges Mission events and evidence into one chronological list. Filters can narrow the timeline by requirement, task, repository, or agent run.

## 5. Onboarding Health

`mission_get_onboarding_health` checks the local project state needed for Trellis SDD:

- project root.
- `.trellis`.
- workflow guide.
- Trellis scripts.
- project agents or skills.
- repository links.
- main project agent.
- SDD mode.
- specs.
- implement/check route.

Checks return machine-readable status/severity plus user-facing detail and suggested action.
