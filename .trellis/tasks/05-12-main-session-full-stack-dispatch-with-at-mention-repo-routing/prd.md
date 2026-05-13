# Main Session Full-Stack Dispatch with @-Mention Repo Routing

## Goal

Build the user-facing dispatch flow that consumes the project-level data model X just shipped: parse `@<roleTag>` mentions from prompts, resolve them to project member repositories, and dispatch `trellis-implement` subagents into each matched repo's worktree. Hide `EmployeeItem` UI entry points when the active project is `wise_trellis`, locking in the contract that wise_trellis projects only show repository members.

This task assumes path X (project-level rootPath, sddMode, mainAgent, repository roleTags) is already in.

## What I Already Know

### From X

- `Project.sddMode: ProjectSddMode` (`"wise_trellis" | "project_owned"`), default `wise_trellis`.
- `Repository.roleTags: string[]` (optional, legacy fallback to `[repositoryType]`).
- `getRoleTags(repo): string[]` and `getEffectiveRepoSddMode(repo, projects): ProjectSddMode` live in `src/utils/projectRepositoryRoles.ts`.
- The project's `.trellis/` is anchored at `project.rootPath`.

### Dispatch primitives already present

- `executeClaudeCodeAndWait` (`src/services/claude.ts`) — the canonical "spawn a Claude Code child process and wait" call.
- `gitWorktreeAddOmcBatch` (`src/services/git.ts:114`) — creates worktree at `<repo>/../<attempt>-worktree/`.
- `TrellisWorkflowAdapter` (`src/services/workflow/trellisAdapter.ts`) — already encapsulates "resolve stage hint → spawn trellis-implement / trellis-check → emit artifact refs". For Y MVP we **reuse it directly** rather than reinventing.
- `repositoryMemberInvocationsStore` (`src/stores/repositoryMemberInvocationsStore.ts`) — invocations written here are picked up by the existing `RepositoryMember` monitor UI.

### Composer entry point

- `handleSendMessageWithTask` is the AppImpl-level outbound handler used by the composer's `onSendMessage`. Intercepting prompts at this layer is far cheaper than threading through `composer-region.tsx` (~1700 lines).

## Scope (Y MVP)

### In scope

1. **Pure parser** `parseAtMentions(prompt: string)` returning `{ mentions: AtMention[], strippedBody: string }`.
2. **Pure resolver** `resolveReposByTag(tag, project, repositories)` matching repos within the project whose `roleTags` (via `getRoleTags`) contains the tag (case-insensitive trimmed).
3. **Dispatch service** `dispatchAtMentionPromptToRepos({ project, projectRepositories, prompt, sessionId, attempt })` — fans out to matched repos using `TrellisWorkflowAdapter.execute`. Returns a list of per-repo results.
4. **Composer interception** at `handleSendMessageWithTask` (or its equivalent): when the active project is `wise_trellis` AND the prompt contains at least one valid `@<tag>` token AND at least one tag resolves to a repo, divert to the new dispatcher and return early. No tag resolves → fall through to legacy behavior with a short user-visible toast (`"@<tag> 未匹配项目仓库"`).
5. **EmployeeItem UI hide** — a small helper `shouldHideEmployeeUi(project): boolean`. Applied at the two highest-leverage entry points: the sidebar Employee section block in `LeftSidebar.tsx`, and the project card employee chip rows. Deeper workflow template composer surfaces are left for a later cleanup pass.
6. **Focused tests** for parser, resolver, dispatcher (with mocked TrellisWorkflowAdapter), and the hide helper.

### Out of scope (Y MVP)

- `@`-mention autocomplete popup in the editor.
- Inline preview chips ("Dispatching to: web/, api/") inside the composer body.
- Multi-tag aggregation UI (we will dispatch one invocation per matched repo and rely on the existing RepositoryMember monitor to visualize).
- Workflow template composer changes around hiding employee assignees — those land in a later cleanup.
- DingTalk inbound rewiring to project mainAgent (kept on legacy `mainOwnerAgentName`).

## Requirements (final)

### Pure logic

- `parseAtMentions("@frontend 改按钮 @backend 加接口")` returns `{ mentions: [{ tag: "frontend", index: 0 }, { tag: "backend", index: <pos> }], strippedBody: "改按钮 加接口" }`.
- Mention regex matches `@<word>` where `<word>` is `[A-Za-z0-9_\-]+`. Adjacent punctuation (`@frontend,` , `@frontend.`) does not consume the comma/period.
- `parseAtMentions("\\@escaped frontend")` returns `{ mentions: [], strippedBody: "@escaped frontend" }` (backslash escape).
- `resolveReposByTag("Frontend", project, repos)` matches case-insensitively and trims whitespace.
- `resolveReposByTag` only considers repos whose id appears in `project.repositoryIds`.
- Tags can match across multiple repos. The dispatcher fans out to each.

### Dispatcher

- For each resolved repo, the dispatcher builds an `executionMetadata` (ownerKind=repository, ownerRepositoryId, repositoryType, subagentType="trellis-implement", stage="implement") and calls `TrellisWorkflowAdapter.execute` with:
  - `workflowRunId`: stable id like `at-mention-${sessionId}-${attempt}`.
  - `repositoryPath`: the matched repo path.
  - `sessionId`: the caller's session id (so the stream UI lands in the right place).
  - `taskId`: synthesized like `at-mention-${timestamp}-${repoId}`.
  - `templateId`: `"trellis"`.
  - `subagentType`: `"trellis-implement"`.
  - `attempt`: 1.
- The stripped body is what gets sent to the subagent (each repo receives the same trimmed instruction).
- Failures per-repo are isolated; one repo failing does not abort the others.

### Composer interception

- New function `tryInterceptAtMentionDispatch({ activeProject, repositories, prompt, sessionId, dispatchFn })` returns `{ handled: true, results } | { handled: false, reason }`.
- Returns `handled: false` when `activeProject.sddMode !== "wise_trellis"` or no mentions parsed.
- Returns `handled: false, reason: "no_tag_matched"` when mentions exist but none resolve.
- Returns `handled: true, results` when at least one tag resolves.

### EmployeeItem UI hide

- New helper `shouldHideEmployeeUi(project: ProjectItem | null | undefined): boolean` returning `true` only when `project?.sddMode === "wise_trellis"`.
- Applied at:
  - The sidebar `Employees` block (existing render guarded by the helper).
  - The project card's employee chip section.
- Does not delete service-layer code; `useOmcRuntime`, DingTalk inbound, scheduled task runner all continue to read `mainOwnerAgentName` and operate on `EmployeeItem` data.

## Acceptance Criteria

- [ ] `bun test` passes with new focused tests:
  - `parseAtMentions` covers: single mention, multiple mentions, escape, punctuation boundary, no mentions, empty input.
  - `resolveReposByTag` covers: case-insensitive match via `roleTags`, legacy `repositoryType` fallback, no match returns empty array, only repos within the project.
  - `dispatchAtMentionPromptToRepos` mocks `TrellisWorkflowAdapter` and asserts: per-repo invocation, executionMetadata shape, isolation on failure.
  - `tryInterceptAtMentionDispatch` returns the right discriminant in all 4 cases.
  - `shouldHideEmployeeUi` returns the right boolean.
- [ ] `bunx tsc --noEmit` clean.
- [ ] `cargo check` unchanged (no Rust changes in Y).
- [ ] Manual reading of `LeftSidebar.tsx` and project-card render confirms employee blocks are guarded by `shouldHideEmployeeUi` when project is wise_trellis.
- [ ] No new external dependencies.
- [ ] Commit hygiene: split into 3 commits — (1) parser + resolver + dispatcher + tests, (2) composer interception wired to `handleSendMessageWithTask`, (3) EmployeeItem UI hide.

## Definition of Done

- Tests added (above).
- TypeScript and Rust pre-existing checks remain green.
- No regression in existing `bun test` suite (currently 145 tests).
- Out-of-scope items are explicitly tracked for a follow-up cleanup task.

## Implementation Plan

### Commit 1 — Pure logic + tests
1. Add `src/services/atMentionDispatch.ts` exporting `parseAtMentions`, `resolveReposByTag`, `dispatchAtMentionPromptToRepos`, `tryInterceptAtMentionDispatch`, and the type `AtMention`.
2. Inject `TrellisWorkflowAdapter` via dependency parameter so tests can mock. Default to the singleton constructed in `src/services/workflow/index.ts`.
3. Add `src/services/atMentionDispatch.test.ts` with bun:test coverage for every public function.

### Commit 2 — Compose-time interception
1. Locate the AppImpl-level callable that drives `onSendMessage` (`handleSendMessageWithTask` and its callers around `src/AppImpl.tsx:558` and `:1474`).
2. Wrap it so the @-mention dispatch is attempted first. On `handled: true`, return without running legacy logic. On `handled: false`, fall through.
3. On `handled: false, reason: "no_tag_matched"`, surface an Ant Design `message.warning("@<tag> 未匹配项目仓库")` so the user sees the no-op rather than silently sending the prompt verbatim.

### Commit 3 — EmployeeItem UI hide + helper
1. Add `shouldHideEmployeeUi` to `src/utils/projectRepositoryRoles.ts` (alongside the existing helpers).
2. Apply it in `src/components/LeftSidebar.tsx` at the employee section (find the existing block via grep for `employees` rendering) and in any project card employee chip render.
3. Add a focused test for `shouldHideEmployeeUi` in `projectRepositoryRoles.test.ts`.
4. Update `.trellis/spec/frontend/quality-guidelines.md` §3 with a brief note that `shouldHideEmployeeUi` is the canonical gate for the conditional employee hide.

## Technical Notes

### Files to read before implementing

- `src/services/workflow/trellisAdapter.ts` — confirm adapter shape, executionMetadata fields.
- `src/services/workflow/index.ts` — get the singleton adapter for default DI.
- `src/AppImpl.tsx` around line 1474 — locate `onSendMessage` wiring.
- `src/components/LeftSidebar.tsx` — locate employee section block.
- `src/utils/projectRepositoryRoles.ts` — existing helpers location.

### Out of Scope tracked for follow-up

- `@`-mention autocomplete popup (good UX, not required for MVP).
- Composer inline visual chips for matched repos.
- Workflow template composer EmployeeItem hiding (lives in `EmployeeConfigModal` and `WorkflowConfigModal`).
- DingTalk inbound migration to project mainAgent.
- Removing legacy `repository_type` and `repo-level sddMode` columns.

### Decision (ADR-lite) — Reuse TrellisWorkflowAdapter

**Context**: Y could either (a) call `executeClaudeCodeAndWait` directly to spawn trellis-implement, or (b) reuse the existing `TrellisWorkflowAdapter` which already encapsulates worktree prep, prompt building, and invocation classification.

**Decision**: Reuse `TrellisWorkflowAdapter`. The adapter already does exactly what Y needs — its only "workflow engine" coupling is the synthesis of `workflowRunId/taskId`, which Y synthesizes itself with stable prefixes.

**Consequences**: Y stays small (~100 lines of new service code + tests). When the adapter is updated later (e.g., to support new stage hints), Y inherits the change for free. The synthetic `workflowRunId` namespacing (`at-mention-...`) keeps Y's invocations separable from real workflow runs in logs.
