# Quality Guidelines

> Code quality standards for frontend development in Wise.

---

## Overview

Quality means preserving the desktop app's runtime contracts: Tauri IPC,
workflow orchestration, Claude process streams, SQLite-backed persistence, and
dense operational UI. Prefer small, testable modules and explicit boundaries
over adding more responsibility to already-large files.

---

## Required Patterns

- Use Bun for JavaScript/TypeScript package scripts.
- Use `bun test` for the current frontend test suite.
- Keep Tauri command calls in `src/services/*`.
- Keep pure workflow/parsing/normalization logic outside React components.
- Add focused tests for pure logic and business-critical parsers.
- Use `Promise.all` for independent async reads.
- Trim and normalize user-entered IDs, names, keys, and paths before persistence.
- Keep event names and shared constants in `src/constants/*`.
- Preserve existing UI libraries before adding new dependencies.

---

## Parallel Ownership

When multiple agents or processes are active in the same dirty worktree, each
change set must stay inside its declared owner paths.

- Do not edit or stage files owned by another active process.
- Use pathspec-limited `git diff`, `git add`, and review commands before
  committing.
- If global checks fail in unrelated owner paths, record the blocking files and
  keep the commit scoped to the current owner.
- Do not mix CSS-only cleanup, Rust command splits, or unrelated refactors into
  a frontend component split commit.

---

## Forbidden Patterns

- Do not run frontend dev/build/start/serve commands during agent verification
  for this project unless the user explicitly changes that rule.
- Do not call `invoke` directly from components.
- Do not add durable application state to `localStorage`.
- Do not add new `any` types.
- Do not store high-frequency streams directly in React state.
- Do not mutate arrays or objects in state.
- Do not introduce a new state library, router, CSS framework, or UI framework
  without a project-level reason.
- Do not broaden desktop file access or asset protocol scope from frontend code.
- Do not grow `src/App.tsx` for feature-specific logic that can live elsewhere.

---

## Testing Requirements

Add or update tests when changing:

- Workflow engine transitions and replay behavior.
- Acceptance verdict parsing and structured decision gates.
- PRD/task splitting, validation, and normalization.
- Persistence adapters or JSON migration logic.
- Utilities that resolve repository/session/task identity.
- Any parser for Claude, terminal, MCP, plugin, or file output.

Existing examples:

- `src/services/workflow/engine.test.ts`
- `src/services/workflow/acceptanceVerdict.test.ts`

Run:

```bash
bun test
```

The TypeScript config currently excludes `src/**/*.test.ts` from `tsc`; Bun is
the test runner for those files.

---

## Scenario: Project-Owned Trellis Execution Metadata

### 1. Scope / Trigger

- Trigger: Trellis execution crosses UI selection, workflow routing, Claude invocation streams, runtime stores, and monitor rendering.
- Applies when the owning `Project.sddMode === "wise_trellis"` and the work belongs to a repository member rather than an `EmployeeItem`.

### 2. Signatures

- `Project.rootPath: string` — absolute path holding `<rootPath>/.trellis/`.
- `Project.sddMode: ProjectSddMode` — `"wise_trellis" | "project_owned"`.
- `Project.mainAgent?: string | null` — reserved for the main-session full-stack dispatch flow.
- `Repository.roleTags?: string[]` — multi-tag routing taxonomy; legacy `repositoryType` is read-deprecated.
- `createProject(name, rootPath?) -> ProjectItem` — optional `rootPath` is path context; Rust resolves it to the nearest Trellis root before persistence.
- `addRepositoryToProject(projectId, repositoryId) -> ProjectItem` — returns the authoritative updated project, including any backend-derived `rootPath`.
- `resolveProjectRootFromRepository(repositoryPath) -> string | null` — service wrapper for probing a selected repo path before project creation.
- `ExecuteTaskInput.executionMetadata?: TrellisExecutionMetadata`
- `OmcWorkflowAdapter.execute(...).executionMetadata?: TrellisExecutionMetadata`
- `WorkflowInvocationStreamDetail.ownerKind?: "repository"`
- `WorkflowInvocationStreamDetail.ownerRepositoryId?: number`
- `WorkflowInvocationStreamDetail.repositoryType?: "frontend" | "backend" | "document"`
- `WorkflowInvocationStreamDetail.stage?: string`
- `WorkflowInvocationStreamDetail.subagentType?: string`

### 3. Contracts

- SDD ownership lives on `Project`, not on `Repository`. Use `getEffectiveRepoSddMode(repo, projects)` to compute the effective mode; never read `repo.sddMode` directly in new code.
- `.trellis/` always sits at `<project.rootPath>/.trellis/`. Repository paths are independent — a repo may sit inside, outside, or anywhere relative to `rootPath`.
- `Project.rootPath` is backend-authoritative. Frontend flows may pass repository path context, but must consume the `ProjectItem` returned by `createProject`, `addRepositoryToProject`, or `listProjects`; do not locally synthesize `rootPath` or append `repositoryIds` after linking.
- Creating a project while a floating repository is selected should promote that repository as the project seed, pass its path as root-detection context, and keep it selected under the new project.
- `PrdSplitWizard` eligibility is a consumer of `Project.rootPath`, not an owner of root detection. If a project has a repository whose ancestor contains `.trellis/scripts/task.py`, the list/add/create project flows should have already backfilled `rootPath` before the wizard filters eligible projects.
- Repository identity is `ownerKind: "repository"` plus `ownerRepositoryId`; do not encode repositories as `EmployeeItem`.
- `Repository.roleTags` is the routing taxonomy (e.g. `["frontend", "test"]`). It is read via `getRoleTags(repo)` which falls back to `[repositoryType]` for legacy rows.
- `repositoryType` is read-deprecated and kept as the single-tag fallback. Do not write new logic that pivots on it.
- Trellis child execution is identified by `stage`, `subagentType`, `taskId`, and `invocationKey`.
- `WorkflowTemplateAssignee.employeeId` must contain real employee ids only. Trellis sub-agent names belong in a separate stage route contract.
- Monitor UI groups Trellis invocations as `repository member -> subagent rows`.
- EmployeeItem UI entry points (config buttons, employee monitor section) are gated by `shouldHideEmployeeUi(activeProject)`; `wise_trellis` projects hide them, `project_owned` projects keep them as a legacy escape hatch.
- `@<roleTag>` prompts arriving at the AppImpl send path are routed via `planAtMentionDispatch` and `dispatchAtMentionPromptToRepos`; matched repos receive a `trellis-implement` subagent with full streamUi attribution so the existing RepositoryMember monitor renders them without bespoke wiring.
- New project-level main sessions resolve their `ClaudeSession.repositoryPath` via `resolveProjectMainSessionAnchor(project, repositories)`. Multi-repo `wise_trellis` projects with a non-empty `rootPath` anchor at the project root; single-repo or `project_owned` projects keep anchoring at the first member repo. The session's `repositoryName` becomes `Project: <name>` when project-rooted, so downstream UI can disambiguate from repo-rooted sessions.

### 4. Validation & Error Matrix

- Missing `ownerRepositoryId` -> do not render as a repository-member invocation row.
- Unknown `repositoryType` -> fall back to repository record type when available.
- Missing `subagentType` -> display `trellis-implement` only as a UI fallback, not as owner identity.
- Project `sddMode = "wise_trellis"` with no invocations -> render every member repo as idle.
- Repo not present in any project -> consult `repo.sddMode` for legacy back-compat; coerce `"off"` to `project_owned`.
- `resolveProjectRootFromRepository` returns `null` when the path is empty, relative, missing on disk, or has no Trellis ancestor; project creation/linking still succeeds but leaves `rootPath` empty.
- `addRepositoryToProject` must be treated as a state replacement, not a void mutation; ignoring its return can leave the UI with stale `rootPath`.

### 5. Good/Base/Bad Cases

- Good: project with `sddMode: "wise_trellis"` shows all its repo members as idle, then `trellis-implement` appears underneath the targeted member during execution.
- Good: selected floating repo `/work/wise/frontend` with `/work/wise/.trellis/scripts/task.py` exists -> new project stores `rootPath: "/work/wise"` and links the repo in one flow.
- Base: non-Trellis employee/team workflows continue to dispatch through `EmployeeItem.agentType` when the owning project is `project_owned`.
- Base: name-only project creation with no selected floating repo creates an empty project with no `rootPath`; a later repository link can backfill it.
- Bad: `employeeId: "trellis-check"` in a workflow assignee, because that makes a child subagent look like a team member.
- Bad: writing to `repo.sddMode` after migration; new code must write `Project.sddMode`.
- Bad: locally doing `{ ...project, repositoryIds: [...project.repositoryIds, repositoryId] }` after linking because it drops backend root-path derivation.

### 6. Tests Required

- Helper tests assert `getRoleTags` fallback and `getEffectiveRepoSddMode` precedence (project > legacy repo > default).
- Helper tests assert selected floating repositories are the only project-creation seed; already-owned repos must not silently seed another project.
- Adapter/engine tests assert metadata reaches workflow events and Claude stream UI params.
- Store/persistence tests assert repository attribution survives snapshot updates and local persistence.
- Monitor overview tests assert project `wise_trellis` repos render as idle members and project `project_owned` hides them even when the legacy repo field disagrees.
- Trellis defaults tests assert stage routing is separate from employee assignees.

### 7. Wrong vs Correct

#### Wrong

```ts
// New code reading repo.sddMode directly
if (repo.sddMode === "wise_trellis") { ... }

// Workflow assignee using a Trellis subagent name as employeeId
assignees: [{ employeeId: "trellis-implement", requiredCount: 1, isRequired: true }]

// Local UI mutation after linking a repo to a project
await addRepositoryToProject(projectId, repositoryId);
setProjects((prev) => prev.map((p) =>
  p.id === projectId ? { ...p, repositoryIds: [...p.repositoryIds, repositoryId] } : p
));
```

#### Correct

```ts
// Compute effective mode via the project-aware helper
if (getEffectiveRepoSddMode(repo, projects) === "wise_trellis") { ... }

executionMetadata: {
  ownerKind: "repository",
  ownerRepositoryId: repository.id,
  repositoryType: repository.repositoryType,
  stage: "implement",
  subagentType: "trellis-implement",
}

const updatedProject = await addRepositoryToProject(projectId, repositoryId);
setProjects((prev) => prev.map((p) => (p.id === projectId ? updatedProject : p)));
```

---

## Scenario: PRD Split Materialized Execution Fan-out

### 1. Scope / Trigger

- Trigger: PRD split execution crosses the split panel, Trellis task writer, workflow facade, OMC batch runner, Claude invocation adapter, and runtime queue UI.
- Applies when confirmed split tasks are written to `.trellis/tasks/` and immediately dispatched to `trellis-implement`.

### 2. Signatures

- `WriteClusterTasksOutput.childTasks[]`: `{ sourceTaskId: string; taskName: string; taskPath: string }`
- `runMaterializedSplitTasksFanout(input) -> ExecutionFanoutResult`
- `runSplitTasksOmcBatch({ executionMetadataByTaskId?: Record<string, TrellisExecutionMetadata> })`
- `TrellisExecutionMetadata.activeTaskPath?: string`
- `SplitTodoCountUpdatedDetail.focusParentTaskName?: string | null`
- `SplitTodoCountUpdatedDetail.focusChildTaskNames?: string[]`

### 3. Contracts

- Source split task ids are planning ids only. They must be remapped through `WriteClusterTasksOutput.childTasks[].sourceTaskId` before dispatch.
- Workflow task ids for materialized PRD split execution are the real Trellis task refs, for example `.trellis/tasks/05-19-prd/05-19-api`.
- Dependency ids must be remapped from source task ids to materialized Trellis refs before `facade.upsertTasks`.
- `Active task:` in the Claude prompt must use `executionMetadata.activeTaskPath` when present; never pass `task-a`/`task-1` style planning ids as the executable Trellis path.
- Batch and single-task “落盘执行” entry points must share the same materialize-and-fan-out helper. Single-task execution passes `parallelGroups = [[task.id]]`.
- Missing `childTasks` mappings are hard failures. Do not silently dispatch fewer tasks than the user confirmed.

### 4. Validation & Error Matrix

- Missing repository path -> show an error and do not write or dispatch.
- Missing Workspace `rootPath` -> writer throws; UI reports “落盘执行失败”.
- Missing `sourceTaskId -> taskPath` mapping -> `runMaterializedSplitTasksFanout` throws before `runSplitTasksOmcBatch`.
- Wave batch returns failures -> mark the wave failed, stop later waves, keep the materialized task focus data visible.
- Empty executable source task list -> show an info message and do not create a parent task.

### 5. Good/Base/Bad Cases

- Good: two source tasks in two waves produce two `.trellis/tasks/...` workflow task ids; the second wave depends on the first materialized ref.
- Good: a single task card action writes one child task and immediately dispatches exactly one implement subagent.
- Base: manual OMC batch execution that does not pass `executionMetadataByTaskId` keeps existing task id behavior.
- Bad: showing “已落盘到 Workspace Trellis” and closing the panel without calling the workflow runner.
- Bad: using the source id as `Active task:` because the subagent cannot locate the materialized task directory.

### 6. Tests Required

- Unit test source id to Trellis task ref mapping and dependency remapping.
- Unit test wave order, workflow run id reuse, and stop-on-failed-wave behavior.
- Regression test incomplete `childTasks` output rejects before dispatch.
- Adapter test `activeTaskPath` appears in `Active task:` while workflow bookkeeping may still keep its own task id.
- Type check after changing workflow metadata or UI event detail fields.

### 7. Wrong vs Correct

#### Wrong

```ts
const { output } = await materializeSplitTasksToWorkspaceTrellis(sourceTasks);
message.success(`已落盘到 Workspace Trellis：${output.parentTaskName}`);
```

#### Correct

```ts
const { output, projectRootPath } = await materializeSplitTasksToWorkspaceTrellis(sourceTasks);
await runMaterializedSplitTasksFanout({
  projectRootPath,
  sourceTasks,
  materializedResult: output,
  parallelGroups,
  onSnapshot: setExecutionFanoutSnapshot,
});
```

---

## Review Checklist

Before considering frontend work done, check:

- Is the new code in the correct layer?
- Are IPC calls behind a service wrapper?
- Are untrusted JSON/text inputs validated?
- Are loading, empty, error, and cancellation states represented?
- Are long-running event subscriptions cleaned up?
- Are expensive derived values memoized or moved out of render?
- Is durable state persisted through the existing service/Rust layer?
- Does the UI remain dense, scannable, and keyboard/mouse usable?
- Are tests added for pure logic or high-risk contracts?

---

## UI Quality

Wise is a desktop productivity tool. The UI should feel quiet, dense, and
operational:

- Prioritize scanning, comparison, and repeated action.
- Use familiar controls: icons for tools, toggles for binary settings, tabs for views.
- Avoid marketing sections, decorative cards, and generic landing-page layouts.
- Do not put cards inside cards.
- Keep text within its container on narrow and wide windows.
- Use stable dimensions for toolbar controls, counters, graph nodes, and list rows.
- Avoid one-note palettes dominated by a single hue family.

---

## Common Mistakes

- Treating Wise like a browser app and introducing route/page structure prematurely.
- Hiding backend failures with `catch {}` in places where the UI needs feedback.
- Testing only the happy path for parser changes.
- Forgetting that GUI app PATH differs from a login shell PATH.
- Adding UI controls whose labels overflow in compact desktop panes.
