# Align Wise Trellis Dispatch With Repository Members

## Goal

When a repository is added with Wise-owned Trellis enabled, Wise should present the repository as a project member and show the Trellis subagents it dispatches underneath that member. A user should be able to see a tree like `Project -> frontend repository member -> trellis-implement subagent`, rather than a flat batch job that hides where the work came from.

The integration should align three concepts:

- A Wise project can contain multiple repositories, such as frontend and backend.
- Each repository is a project member from the UI and dispatch perspective.
- Trellis subagents run under that repository member and should be visible as child execution units.

## What I Already Know

- `Repository.repositoryType` already stores `frontend | backend | document`, and repository add UI labels these as role-like presets.
- `Repository.sddMode` already supports `auto | wise_trellis | project_owned | off`.
- `EmployeeItem.agentType` is the existing Wise field that maps a UI member to a Claude slash/subagent command.
- Team workflow dispatch already resolves a member and prefixes the worker prompt with `/${employee.agentType}`.
- Current Trellis batch dispatch bypasses the team/member model and hard-codes `subagentType: "trellis-implement"` in `ClaudeChat`.
- `buildTrellisTeamTemplate` currently uses Trellis agent names as placeholder `employeeId` values, which does not match the existing `WorkflowTemplateAssignee.employeeId -> EmployeeItem.id` contract.
- Trellis specs can already separate areas such as frontend and backend, so Wise should not duplicate that taxonomy as independent worker identities when Trellis owns the SDD flow.

## Target Mental Model

Wise should model Trellis execution as a tree:

```text
Project
  Repository member: frontend app
    Trellis spec area: frontend
      Subagent: trellis-research
      Subagent: trellis-implement
      Subagent: trellis-check
  Repository member: backend api
    Trellis spec area: backend
      Subagent: trellis-research
      Subagent: trellis-implement
      Subagent: trellis-check
```

The repository is the member because it owns the worktree, SDD mode, spec area, and runtime context. The subagent is a child process/agent launched by that member.

## Requirements

- Wise-owned Trellis repositories are displayed as project members in the relevant project/team UI.
- Repository member identity is based on the repository record, not on `EmployeeItem`.
- Existing employee/team workflows continue to work unchanged for non-Trellis flows.
- Trellis subagent execution is attributed to the repository member that dispatched it.
- Trellis batch execution should stop hard-coding one global `trellis-implement` path as the visible owner.
- Runtime/progress UI should distinguish:
  - repository member
  - Trellis stage/spec area
  - child subagent type
  - task id / worktree / invocation status
- `WorkflowTemplateAssignee.employeeId` must not contain placeholder agent names. If a Trellis team template is kept, it must either resolve to real member IDs or use a separate Trellis-specific routing contract.
- The UI should make tree dispatch obvious: repository rows can expand to show active child subagents.
- Existing `Repository.mainOwnerAgentName` remains useful as the default main/owner agent for a repository, but it is not enough to represent all Trellis child subagents.

## Acceptance Criteria

- [ ] Adding/importing a repository with `sddMode = "wise_trellis"` creates or exposes a repository-member execution identity.
- [ ] A project containing frontend and backend repositories shows them as distinct members.
- [ ] Starting Trellis work from a frontend repository displays child execution under that repository member.
- [ ] Trellis child execution records include the effective `subagentType`, repository id/path, task id, and stage/spec area where available.
- [ ] The old direct Trellis batch path no longer appears as an ownerless/global `trellis-implement` run.
- [ ] Existing employee dispatch still prefixes prompts with `/${employee.agentType}` and does not regress.
- [ ] `bunx tsc --noEmit` and `bun test` pass.

## Proposed Implementation Shape

### 1. Introduce a Repository Member Runtime Concept

Do not force repositories into `EmployeeItem`. Keep the existing employee model for human/agent workers and add a small view/runtime model:

```ts
type ProjectMember =
  | { kind: "employee"; employeeId: string }
  | { kind: "repository"; repositoryId: number };
```

This can initially live as a frontend utility/view model rather than a persisted DB table.

### 2. Attribute Trellis Dispatches to Repository Members

Extend Trellis execution metadata so each invocation can be rendered as:

```ts
{
  ownerKind: "repository",
  ownerRepositoryId: number,
  repositoryPath: string,
  subagentType: "trellis-implement",
  stage: "implement",
  taskId: "...",
}
```

The current adapter only receives `repositoryPath`, `taskId`, `templateId`, and `subagentType`. It needs enough owner metadata to render tree dispatch correctly.

### 3. Split Trellis Stage Routing From Team Employee Routing

Trellis stage routing should not abuse `WorkflowTemplateAssignee.employeeId`. Use one of these approaches:

- Preferred: a Trellis-specific stage plan maps stage names to subagent types, while repository membership comes from the selected repository.
- Acceptable MVP: keep `subagentType` as execution hint but source it from a Trellis stage plan, not from a hard-coded UI call site.

### 4. Render Repository -> Subagent Tree

In monitor/progress UI, group Trellis invocation records by repository member first, then show child subagent rows. For example:

```text
frontend app                    running
  trellis-implement              task FE-12, attempt 3
  trellis-check                  waiting
backend api                      idle
```

### 5. Keep Spec Area As Context, Not Member Identity

`frontend/backend/document` can seed or filter Trellis spec areas. It should not become a separate worker identity if the repository already represents that role.

## Out of Scope

- Replacing the existing employee/team workflow model.
- Persisting a new member table before the runtime/view model proves useful.
- Implementing full Trellis task bidirectional sync beyond the metadata needed for attribution.
- Parsing Claude stdout to infer execution hierarchy.

## Technical Notes

- Current hard-coded path: `src/components/ClaudeSessions/ClaudeChat.tsx`.
- Current Trellis adapter: `src/services/workflow/trellisAdapter.ts`.
- Current placeholder template issue: `src/services/workflow/trellisDefaults.ts`.
- Existing team employee dispatch model: `src/hooks/useWorkflowTeamAutomation.ts` and `src/services/workflowGraphHelpers.ts`.
- Existing repository role fields: `src/types.ts`, `src/components/LeftSidebar.tsx`, `src/services/repository.ts`.
- Existing progress surface likely affected: `src/components/ProgressMonitorDrawer`.
