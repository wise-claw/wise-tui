# P1 Mission Planning Mutations and Main-Session Synchronization

## 1. Background

Mission Control can already display and edit PRD split planning state through reducer actions such as requirement reassignment, manual cluster creation, cluster rename, and task edits. Frontend drag-and-drop can call these actions directly, but direct mutation is not enough for a serious product workflow.

Users need to understand the impact of moving a requirement before committing the change. They also need the project-level main chat session and the Mission panel to stay synchronized, because Wise's product model is one project-level orchestrator plus repository/stage subagents.

This P1 builds on the P0 Mission ledger by adding backend-backed planning mutations and a synchronization bridge between Mission Control and the main project chat.

## 2. Product Goal

Make Mission planning changes explainable, previewable, and synchronized with the main project session.

After this task:

- Dragging a requirement to another cluster/repository can show impact before commit.
- Manual cluster creation and cluster rename are recorded as Mission planning events.
- The main chat can attach to a Mission and receive Mission updates.
- Mission Control can inject a user instruction into the relevant main session or subagent route.

## 3. Scope

### 3.1 Requirement Reassignment Preview

Add backend APIs for previewing and committing requirement movement.

Required capabilities:

- `previewRequirementReassign(missionId, requirementId, targetClusterId)`
- `commitRequirementReassign(missionId, previewId)`
- Preview returns affected clusters, dirty cluster count, tasks that will be invalidated, manual edits at risk, dependencies to recalculate, and agent runs that need retry/cancel.
- Commit appends a Mission event and returns the updated Mission snapshot.
- Preview must be deterministic for the same Mission snapshot and input.

### 3.2 Planning Mutation Events

Record important planning edits as Mission events.

Required mutation events:

- Requirement reassigned.
- Manual cluster created.
- Cluster renamed.
- Task dependencies edited.
- Manual task created/edited/deleted/restored.
- PRD/task anchors edited.

### 3.3 Main Session Synchronization

Bind Mission state to the project-level chat session.

Required capabilities:

- Attach a Mission to a main session: `attachMissionToSession(sessionId, missionId)`.
- Resolve active Mission for a session.
- Append a structured Mission decision/instruction into the session timeline.
- Route a Mission instruction to a target task, cluster, repository, or agent assignment.
- Emit frontend events when a Mission update originated from chat or from the panel.

### 3.4 Agent Control Commands

Provide backend command contracts for agent controls used by the UI.

Required commands:

- Retry an agent or cluster run.
- Pause/cancel a queued or running run where supported.
- Inject instruction into an active or next-run agent context.
- Record the command and result as Mission events.

## 4. User Stories

### Story 1: Preview Before Moving a Requirement

As a user, I drag a requirement to a backend cluster and see: "2 clusters become dirty, 3 task edits may be discarded, 1 running agent should be retried." I can then commit the move with confidence.

### Story 2: Chat and Panel Stay in Sync

As a user, I can say in the main project chat "move the JWT refresh requirement to backend" and see the Mission panel update. If I move it in the panel, the main session records that decision.

### Story 3: Inject Direction Into a Running Mission

As a user, I can select a task and inject "keep the public API backward compatible"; the instruction is stored on the Mission and delivered to the relevant agent route.

## 5. Acceptance Criteria

- Requirement reassignment can be previewed without mutating Mission state.
- Preview includes dirty clusters, invalidated tasks, edit-loss risk, dependency impact, and run-control impact.
- Committing a preview updates the Mission snapshot and appends a durable event.
- Manual cluster and task planning edits are recorded in the Mission event log.
- A Mission can be attached to a project-level main session.
- Mission-originated and chat-originated updates are distinguishable in event metadata.
- Agent retry/pause/cancel/instruction commands have stable backend contracts even if some operations are best-effort for the current runtime.

## 6. Non-Goals

- Do not build the frontend drag-and-drop UI in this task.
- Do not implement the P0 Mission ledger from scratch here; this task depends on it.
- Do not build full replay/evidence timelines; that is P2.
- Do not require every agent runtime to support true process pause. Unsupported runtimes may record "cancel requested" or "pause unsupported" explicitly.

## 7. Product Principle

Mission Control should not silently mutate complex SDD plans. Every planning change should have an explainable preview, a durable decision record, and synchronization with the project-level orchestrator conversation.
