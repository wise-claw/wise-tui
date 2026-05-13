# Anchor wise_trellis main session at project rootPath

## Goal

Decouple the project-level "main session" from any single member repository. For multi-repo `wise_trellis` projects, new sessions created via project-level entry points anchor at `project.rootPath` instead of `repositories[0].path`. This makes the main session a true full-stack coordinator: its cwd is the project root (where `.trellis/` lives), and member repositories become dispatch targets via the existing `@`-mention path Y already ships.

Single-repo projects (including wise itself) are unchanged because `rootPath` equals the only repo's path in the degenerate case.

## What I Already Know

- `Project.rootPath: string` and `Project.sddMode: ProjectSddMode` shipped in path X (`src/types.ts:60-72`).
- `handleCreateProjectTask` (`src/AppImpl.tsx:1244`) is the project-level entry point. It currently always anchors to `repos[0]` regardless of `rootPath` or `sddMode`.
- `handleCreateRepositoryTask` (`src/AppImpl.tsx:1214`) is the repo-level entry. It should keep current behavior (user explicitly picked a repo).
- `ClaudeSession.repositoryPath: string` and `ClaudeSession.repositoryName: string` are required, non-nullable (`src/types.ts:517`). We keep the field shape and just write `project.rootPath` / `Project: <name>` into them for project-rooted sessions.
- `createSession(repositoryPath, repositoryName)` (`useClaudeSessions.ts:1012`) accepts any path string; it does not validate against the repos list. So writing project.rootPath is type-safe.
- Y's `handleSendMessageWithAtMention` (`src/AppImpl.tsx`) already resolves `activeProject` independent of `activeRepository`, so @-mention routing works correctly when the session sits at project root.
- `bindRepositoryMainSession(path, sessionId)` (`AppImpl.tsx:233`) is per-path; it still works if the path is `project.rootPath`.

## Scope (C MVP)

### In scope

1. New pure helper `resolveProjectMainSessionAnchor(project, repositories)` returning `{ path, displayName, isProjectRooted }`. For wise_trellis multi-repo projects with non-empty rootPath: returns rootPath + `Project: <name>` + isProjectRooted=true. For everything else: returns the existing fallback (first repo path + `<project>/<repo>` + isProjectRooted=false).
2. `handleCreateProjectTask` uses the helper.
3. The session display label distinguishes project-rooted sessions ("Project: <name>") from repo-rooted ones.
4. `bindRepositoryMainSession` is called with the resolved path (so the binding still works whether path is repo or project root).
5. `useMonitorOverview` and any other code that does `repositories.find((r) => r.path === session.repositoryPath)` is updated only if it breaks under project-rooted sessions; otherwise left alone (project-rooted sessions just don't match any repo, which is acceptable for a "project-level" entity).
6. Focused tests for the helper.

### Out of scope (deferred)

- Changes to `Session` type to add `scope: "project" | "repository"` — keep type shape stable.
- UI selector for "switch session context between project root and a specific member repo" — defer to a future polish task.
- Removing repo selection from the LeftSidebar navigation flow — keep `selectProjectAndRepository` available; it just isn't required for new project sessions in multi-repo wise_trellis projects.
- Migrating existing sessions to project root — only new sessions are affected.
- Path X's `mainAgent` field consumption — still reserved for later.

## Requirements (final)

### Pure helper

- `src/utils/projectSessionAnchor.ts`:
  - `interface ProjectSessionAnchor { path: string; displayName: string; isProjectRooted: boolean }`
  - `resolveProjectMainSessionAnchor(project, repositories) -> ProjectSessionAnchor`
  - Decision tree:
    - If `project.sddMode === "wise_trellis"` AND `project.repositoryIds.length > 1` AND `project.rootPath` is non-empty → return `{ path: rootPath, displayName: "Project: " + project.name, isProjectRooted: true }`.
    - Else (single repo, or project_owned, or empty rootPath) → return `{ path: firstRepo.path, displayName: project.name + "/" + folderBasename(firstRepo), isProjectRooted: false }`. Falls back to a sentinel `{ path: "", displayName: project.name, isProjectRooted: false }` only when the project has zero member repos AND no rootPath (caller still has to handle empty path).
- Pure, no React, no Tauri.

### AppImpl wiring

- `handleCreateProjectTask` calls the helper, uses returned `{ path, displayName }` for `createSession` and `bindRepositoryMainSession`.
- `setActiveRepositoryId` is set to the first repo's id when project-rooted (for sidebar highlighting), but the session's repository_path stores the project root path. The repo selection in the sidebar is purely a UI hint for project-rooted sessions; @-mention dispatch ignores it.

### Tests

- `src/utils/projectSessionAnchor.test.ts`:
  - wise_trellis + 2 repos + rootPath set → project-rooted.
  - wise_trellis + 1 repo → repo-rooted (degenerate).
  - project_owned + N repos → repo-rooted (legacy).
  - wise_trellis + N repos + empty rootPath → repo-rooted (back-compat for unmigrated projects).
  - Zero member repos + rootPath set → returns rootPath with isProjectRooted=true (single edge case: project exists, no repos yet, rootPath was explicitly set).
  - Zero member repos + empty rootPath → returns empty path sentinel.

## Acceptance Criteria

- [ ] `bun test` passes with new focused tests.
- [ ] `bunx tsc --noEmit` clean.
- [ ] `cargo check` unchanged (no Rust changes).
- [ ] Manual inspection: `handleCreateProjectTask` calls the helper and uses both `path` and `displayName` from its result.
- [ ] For the wise project itself (single repo), the behavior is unchanged: rootPath = wise repo path = `/Users/starlight/Documents/wise`, helper returns `isProjectRooted=false`, session anchors at the wise repo as before.
- [ ] Commit hygiene: single commit since the change is one helper + one consumer + tests.

## Definition of Done

- Tests added (above).
- Lint / typecheck green.
- No new external dependencies.
- Spec update (`.trellis/spec/frontend/quality-guidelines.md` §3) adds one line noting that wise_trellis multi-repo project sessions anchor at `Project.rootPath`.

## Implementation Plan

### Single commit
1. Add `src/utils/projectSessionAnchor.ts` with the helper and types.
2. Add `src/utils/projectSessionAnchor.test.ts` covering all 6 branches in the decision tree.
3. Refactor `handleCreateProjectTask` (`AppImpl.tsx:1244-1278`) to call the helper. Replace the hardcoded `primaryRepo.path` and `${project.name}/${repositoryFolderBasename(primaryRepo)}` literals with helper-derived values.
4. Update `.trellis/spec/frontend/quality-guidelines.md` §3 with the project-rooted main session note.
5. `bun test` + `bunx tsc --noEmit` green.

## Technical Notes

### Decision (ADR-lite) — Keep session type stable

**Context**: Three options existed for decoupling main session from a single repo: (A) introduce `Session.scope`, (B) designate a "primary" repo, (C) overload `repositoryPath` to also accept project root.

**Decision**: Option C. `ClaudeSession.repositoryPath` keeps its `string` shape; for wise_trellis multi-repo projects we write `project.rootPath` into that field. Display name becomes "Project: <name>" to disambiguate.

**Consequences**: 
- Zero type changes; zero migration for existing sessions.
- Single-repo projects degenerate to current behavior because `rootPath === repos[0].path`.
- Some downstream code that does `repositories.find((r) => r.path === session.repositoryPath)` will return undefined for project-rooted sessions — that is the correct semantic (no single repo "owns" the main session). UI sites that depend on this lookup need to handle the undefined gracefully; in practice they already do because repository lookups can fail for other reasons.
- Composer @-mention dispatch (path Y) already works since it routes via `activeProjectId`, not `session.repositoryPath`.