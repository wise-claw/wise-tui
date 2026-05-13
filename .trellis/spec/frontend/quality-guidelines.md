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

### 5. Good/Base/Bad Cases

- Good: project with `sddMode: "wise_trellis"` shows all its repo members as idle, then `trellis-implement` appears underneath the targeted member during execution.
- Base: non-Trellis employee/team workflows continue to dispatch through `EmployeeItem.agentType` when the owning project is `project_owned`.
- Bad: `employeeId: "trellis-check"` in a workflow assignee, because that makes a child subagent look like a team member.
- Bad: writing to `repo.sddMode` after migration; new code must write `Project.sddMode`.

### 6. Tests Required

- Helper tests assert `getRoleTags` fallback and `getEffectiveRepoSddMode` precedence (project > legacy repo > default).
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
