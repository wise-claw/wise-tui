# P0 Mission Ledger, Traceability Index, and Live Agent Assignments

## 1. Background

Mission Control is becoming the primary Wise surface for PRD-driven Trellis work. The current UI can project requirements, clusters, tasks, anchors, and splitter status from reducer state and filesystem scans, but the backend still lacks a single durable Mission model.

This creates three product problems:

- A Mission is not a first-class recoverable object. Closing and reopening the panel depends on reconstructing state from scattered artifacts.
- Requirement traceability stops at planning-time task metadata. It cannot reliably answer what code changed, who changed it, and how it was verified.
- The "team" and subagent surfaces cannot show real work ownership because agent activity is not represented as durable assignment state.

The goal of this P0 is to create the backend foundation that makes Wise visibly different from a generic AI coding UI: every PRD requirement becomes a durable, queryable, replayable unit of work connected to tasks, repositories, code anchors, and live agent ownership.

## 2. Product Goal

Make Mission runs, Mission events, requirement traceability, and live agent assignments first-class backend concepts.

After this task, Mission Control can truthfully show:

- What Mission is currently active for a project.
- Which PRD requirements belong to the Mission.
- Which clusters and tasks each requirement produced.
- Which repositories and agents own each task.
- Which files are expected or known to be touched.
- Which subagent is currently working in which repository.
- Enough persisted event history to recover the Mission after the UI closes.

## 3. Scope

### 3.1 Mission Ledger

Add a persistent backend ledger for Mission runs and events.

Required capabilities:

- Create or resume a Mission for a project/root path.
- Persist Mission identity, project identity, PRD hash, requirements index, cluster plan, reducer edits, and current stage.
- Append typed Mission events for parse, plan, dispatch, write, agent assignment, evidence, and failure events.
- Read the latest Mission snapshot by `missionId`.
- List recent Missions for a project.
- Recover an in-progress Mission after app restart.

### 3.2 Requirement Traceability Index

Add a backend query surface that answers a requirement-centric trace.

Required capabilities:

- Query `getRequirementTrace(missionId, requirementId)`.
- Return the PRD source paragraph or excerpt for the requirement.
- Return associated clusters and tasks.
- Return task metadata: title, status, repository, role, priority, assignee/agent if known, source requirement IDs.
- Return task code anchors and related files where available.
- Return parent/child Trellis task paths where available.
- Return known agent run state for each task.

### 3.3 Live Agent Assignments

Add a persistent and live-readable model for subagent work ownership.

Required capabilities:

- Create/update/complete an agent assignment for a Mission task.
- Store agent type, repository, task, stage, status, current file, session ID, timestamps, and last heartbeat.
- List active assignments by project and Mission.
- Emit frontend events when assignments change.
- Mark stale assignments when heartbeat expires or the process finishes without a clean completion event.

## 4. User Stories

### Story 1: Recover Mission State

As a user, I can close Mission Control while a PRD split or Trellis run is active, reopen it later, and see the same Mission with current status instead of a reset screen.

### Story 2: Trace One Requirement

As a user, I can select a requirement and see the original PRD paragraph, generated tasks, target repositories, code anchors, and current agent ownership in one trace result.

### Story 3: See Who Is Working Where

As a user, I can look at the team panel and see that `trellis-implement` is working on a backend task in the backend repository, while `trellis-check` is queued for another task.

## 5. Acceptance Criteria

- A durable Mission record exists for a PRD-driven Mission and survives app restart.
- Mission events are append-only and can be queried back in creation order.
- The backend can return a latest Mission snapshot without requiring the React reducer to still be alive.
- `getRequirementTrace` returns PRD excerpt, clusters, tasks, repositories, code anchors or related files, and agent assignment state for a selected requirement.
- Agent assignments can be created, updated, completed, and listed by Mission/project.
- Frontend-facing event payloads are stable and typed.
- Existing MissionControl behavior keeps working while the backend ledger is introduced.
- No mock agent rows remain necessary for Mission-level live ownership once the UI consumes this backend.

## 6. Non-Goals

- Do not redesign the frontend in this task.
- Do not implement drag-and-drop reassignment impact preview; that is P1.
- Do not implement full evidence capture such as tests, screenshots, commits, or replay timelines; that is P2.
- Do not change Trellis task file schema unless an additive `meta` field is required.
- Do not require network services or a cloud backend.

## 7. Product Principle

This is the foundation for the Wise/Trellis difference: SDD work must be accountable. A Mission is not just a UI session; it is a durable ledger connecting requirements, tasks, agents, repositories, and evidence.
