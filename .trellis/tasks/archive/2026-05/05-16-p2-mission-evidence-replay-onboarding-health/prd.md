# P2 Mission Evidence Replay and Onboarding Health

## 1. Background

P0 makes Mission state durable and traceable. P1 makes planning mutations explainable and synchronized with the main session. The next layer of product differentiation is proof: Wise should show not only what was planned, but what actually happened and how it was verified.

Trellis SDD becomes legible to new users when every Mission can be replayed as a story:

PRD requirement -> task -> agent work -> changed files -> tests/checks -> spec updates -> commit/PR.

This P2 turns Mission history into evidence and onboarding surfaces.

## 2. Product Goal

Capture delivery evidence, support Mission replay, and expose Trellis onboarding health checks.

After this task:

- Each completed task can show changed files, diff summary, validation output, and commit/PR references where available.
- A Mission can be replayed as a chronological timeline.
- New users can see whether their project is ready for Trellis SDD and what is missing.

## 3. Scope

### 3.1 Delivery Evidence Capture

Add backend evidence capture for Mission tasks.

Required evidence types:

- Git diff summary before and after agent execution.
- Changed files.
- Test/typecheck/lint command results.
- Agent stdout/stderr excerpts.
- Commit hash and PR URL where available.
- Spec update diff or affected spec files.
- Screenshot/artifact references where available.

Evidence should be associated with `missionId`, `taskId`, `agentRunId`, repository path, and timestamp.

### 3.2 Mission Replay

Add backend APIs for replaying a Mission timeline.

Required capabilities:

- Query chronological Mission events and evidence as one timeline.
- Filter by requirement, task, repository, or agent.
- Return replay entries suitable for a UI timeline.
- Include enough metadata to jump from a timeline item to the relevant task, file, diff, session, or PR.

### 3.3 Trellis Onboarding Health

Add backend checks that explain whether a project is ready for Trellis SDD.

Required checks:

- Project root exists and has/does not have `.trellis`.
- `.trellis/workflow.md` exists.
- Required Trellis scripts exist.
- Required agent/skill definitions exist for the detected platform.
- Repository role tags are configured.
- Project main agent is configured.
- SDD mode is compatible with Mission Control.
- Spec directories exist and are not empty.
- At least one implement/check route is available.

The result should include severity, human-readable issue, and suggested action.

## 4. User Stories

### Story 1: Prove a Requirement Was Delivered

As a user, I select a completed requirement and see changed files, tests, checks, commit hash, and agent transcript snippets proving how it was delivered.

### Story 2: Replay a Mission

As a user, I open a past Mission and replay its timeline from PRD parsing to final write/check/spec update, filtered by one repository or one requirement.

### Story 3: New User Understands What Is Missing

As a new user, I open a project and see a clear Trellis readiness report: agents installed, specs missing, role tags incomplete, or SDD mode disabled.

## 5. Acceptance Criteria

- Mission evidence records can be written and queried independently of the frontend lifecycle.
- Git changed-file and diff summaries are captured per task/agent run where a git repository is available.
- Validation command results can be stored with command, status, duration, stdout/stderr excerpt, and timestamp.
- Mission replay returns a stable chronological list combining Mission events and evidence.
- Replay can be filtered by requirement, task, repository, and agent.
- Onboarding health returns machine-readable checks and user-facing explanations.
- Health checks do not read secrets or print environment values.
- Existing Mission execution remains usable if evidence capture partially fails; failures are recorded as evidence warnings.

## 6. Non-Goals

- Do not build the full replay UI in this task.
- Do not require cloud storage.
- Do not upload screenshots or artifacts externally.
- Do not enforce a single test command across all projects.
- Do not block Mission completion solely because optional evidence capture failed.

## 7. Product Principle

Trellis SDD should make AI work auditable. The product should help a newcomer understand both the process and the proof: what changed, why it changed, who changed it, and what verified it.
