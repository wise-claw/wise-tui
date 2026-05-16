# Promote Project to Trellis Root with Repo Role Tags

## Goal

Restructure Wise's data model so that the `Project` becomes the owner of the Trellis SDD lifecycle (holding the single `.trellis/` directory), and `Repository` becomes a tagged dispatch target with multi-valued `roleTags: string[]`. This unblocks the project-level full-stack main session model: one project, multiple repos as members, one `.trellis/` for shared spec + tasks, role tags as the routing key (`@frontend`, `@backend`).

This is the data-model foundation for path Y (main session full-stack dispatch with `@`-mention routing), which is tracked as a separate task and will start after X lands.

## What I Already Know

### Current storage shape

- `~/.wise/repositories.json` — `StoredRepository`. Field `repository_type: String` is single-valued (`"frontend" | "backend" | "document"`, defaults to `"frontend"`). Field `sdd_mode: Option<String>` is per-repo (`"auto" | "wise_trellis" | "project_owned" | "off"`). Field `main_owner_agent_name: Option<String>` is the legacy repo-level default agent.
- Projects live in SQLite (`wise_db::WiseProjectRow`), not JSON. `StoredProject` has `id, name, repository_ids[], created_at, updated_at, iconDisplayName, iconColor` — no `rootPath` field.
- `~/.wise/projects.json` is the legacy migration source only; current source of truth is the SQLite table.

### Current code surfaces that need touching

- `src/types.ts:51-57` (`ProjectItem`), `src/types.ts:4-26` (`Repository`), `src/types.ts:28` (`SddMode`).
- `src-tauri/src/app_state_commands.rs:18-43` (`StoredRepository`), `src-tauri/src/app_state_commands.rs:66-76` (`StoredProject`), `src-tauri/src/wise_db.rs` (project table schema).
- `src/services/repository.ts` — `updateRepositorySddMode`, validation list.
- `src/services/trellis/sddModeDetector.ts` — auto-resolves `wise_trellis` based on filesystem signals.
- `src/hooks/useMonitorOverview.ts:194-272` — `buildRepositoryMemberMonitorItems` keys off `sddMode === "wise_trellis"`.
- `src/components/SddModeSwitch/index.tsx` — current UI surface for the per-repo SDD mode.
- `.trellis/spec/frontend/quality-guidelines.md` §3 — already codifies that `ownerKind: "repository"` is the runtime identity (the spec contract this task evolves).

### Confirmed design intuitions (from prior brainstorm)

- Trellis spec is already organized by **area** (`spec/frontend/`, `spec/tauri/`, `spec/guides/`), not by repo. The project-level `.trellis/` is what Trellis was designed for; current per-repo `.trellis/` is the degenerate 1-repo case.
- `Repository.repositoryType` is already a role tag, just singular. Generalizing to `roleTags: string[]` is a minimal rename + array conversion.
- `EmployeeItem` will be **hidden** from the UI as part of this task, not deleted (DingTalk inbound, `mainOwnerAgentName`, legacy workflow templates still depend on the underlying service layer).
- Single-repo projects (including wise itself) keep working unchanged: `.trellis/` at the lone repo root = project root in the degenerate case.

## Assumptions (to validate)

- `Repository.roleTags: string[]` is free-form (not enum-constrained), but UI offers `frontend / backend / document / test / shared` as suggested presets.
- `Repository.repositoryType` (singular) is **kept** during migration as `roleTags[0]` backing source; reads are folded through a single getter that returns `roleTags`. Writes deprecate the singular field. After migration window closes (later cleanup task), the singular field is removed.
- `Repository.sddMode` becomes meaningless once project owns SDD. We **keep** the column on `StoredRepository` (serde default `None`) for back-compat but stop reading it after migration; the project gains `sddMode: SddMode` (default `"wise_trellis"`).
- Adding `Project.rootPath: String` requires a SQLite schema migration on the projects table. Migration default for existing projects = path of `repositories[repository_ids[0]].path` (the first repo's path).
- `EmployeeItem` data layer stays intact; only UI entry points hide.

## Open Questions

### Q1 — RESOLVED
**Decision**: Independent project root. `Project.rootPath` is its own field; `.trellis/` always lives at `<rootPath>/.trellis/`. Repository paths are independent and may be inside, outside, or anywhere relative to `rootPath`. For Wise itself, `rootPath = /Users/starlight/Documents/wise` (the single-repo case where root and repo path happen to coincide).

### Q2 — RESOLVED
**Decision**: Hybrid — preset chips for common tags (`frontend`, `backend`, `document`, `test`, `shared`, `infra`, `mobile`) plus an "Add custom..." input. Persistence accepts any non-empty trimmed string. `@`-mention parser in Path Y matches by exact string; unknown tags don't error but produce a "no repo matched" hint.

### Q3 — RESOLVED
**Decision**: Migration backfill — `Project.rootPath` defaults to `repositories[repository_ids[0]].path`. For the wise project record this is `/Users/starlight/Documents/wise`, exactly where the current `.trellis/` lives, so existing behavior is preserved with zero structural change. Projects with empty `repository_ids` get an empty string and the first open dialog will require the user to pick. Users can move the root later via project settings.

### Q4 — RESOLVED
**Decision**: `Project.sddMode` is a 2-value enum: `"wise_trellis" | "project_owned"`. Default for new projects = `"wise_trellis"`. `auto` becomes a one-shot creation-time suggestion only (UI helper, not persisted state). `off` is dropped — a project that doesn't want SDD has no reason to exist as a project (open a bare repo window instead). Migration from existing repo-level values: `auto` → run signal detection once and persist resolved value; `wise_trellis` → keep; `project_owned` → keep; `off` → coerce to `project_owned` (preserve user's "don't write .trellis/" intent without inventing a new state). `Repository.sddMode` becomes read-deprecated.

### Q5 — RESOLVED
**Decision**: Conditional hide based on `Project.sddMode`. For `wise_trellis` projects, `EmployeeItem` disappears from: sidebar, project cards, progress monitor rows, and workflow template composer assignee picker. For `project_owned` projects, the existing `EmployeeItem` UI remains untouched as a legacy escape hatch. Underlying employee service, `mainOwnerAgentName`, DingTalk inbound, and scheduled task runner paths are not modified by this task — they continue to use the existing data layer.

### Q6 — RESOLVED
**Decision**: Add `Project.mainAgent: Option<String>` in this task. Migration default = first repo's `mainOwnerAgentName`. The field is reserved for path Y consumption; path X does not change DingTalk inbound, scheduled task runner, or main session binding behavior — they keep reading per-repo `mainOwnerAgentName`. After Y consumes the project-level field, a later cleanup task can deprecate `mainOwnerAgentName`.

## Scope Narrowing (post-Q&A)

After the six Q&As resolved, the MVP for X is intentionally tightened to **data layer + a single semantic switch**, deferring UI-surface work to path Y where the dispatch UX naturally consumes it:

**In scope (X)**:
- SQLite schema migration adding `root_path`, `sdd_mode`, `main_agent` columns on `projects` table.
- Rust types (`WiseProjectRow`, `StoredProject`, `StoredRepository`) plus 4 new Tauri commands.
- Frontend types (`Project.rootPath / sddMode / mainAgent`, `Repository.roleTags`, narrowed `SddMode` enum).
- Service wrappers in `src/services/repository.ts` and (new) project setters.
- Pure helpers + tests: `getRoleTags(repo)`, `getEffectiveRepoSddMode(repo, projects)`.
- `buildRepositoryMemberMonitorItems` consults project-level `sddMode` via the helper instead of `repo.sddMode`.
- Spec update: `.trellis/spec/frontend/quality-guidelines.md` §3 reflects the project-level SDD contract.

**Deferred to Y (out of scope for X)**:
- `RoleTagsEditor` UI component.
- Project settings page UI for `rootPath` / `sddMode` / `mainAgent`.
- Conditional UI hide of `EmployeeItem` (Q5 contract stands, implementation lands in Y where the new dispatch UI replaces the current employee surface).
- Workflow template composer assignee picker changes.
- Migration of `mainOwnerAgentName` consumers (DingTalk, main session binding) — these keep reading the legacy field until Y rewires.

## Requirements (final)

### Data model

- `Project` gains `rootPath: string` (absolute path).
- `Project` gains `sddMode: SddMode` (default `"wise_trellis"`, enum narrows to `"wise_trellis" | "project_owned"`).
- `Project` gains `mainAgent: string | null` (reserved for path Y).
- `Repository` gains `roleTags: string[]` (kept alongside legacy `repositoryType` during the deprecation window).
- `Repository.sddMode` and `Repository.repositoryType` become read-deprecated (kept on storage; never overwritten by new writes after migration).

### Persistence

- New migration `016_project_trellis_root.sql`:
  ```sql
  ALTER TABLE projects ADD COLUMN root_path TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN sdd_mode TEXT NOT NULL DEFAULT 'wise_trellis';
  ALTER TABLE projects ADD COLUMN main_agent TEXT;
  ```
- `WiseProjectRow` adds `root_path: String`, `sdd_mode: String`, `main_agent: Option<String>`. `list_projects` selects the new columns.
- `StoredRepository` adds `#[serde(default)] role_tags: Vec<String>`. On read, if `role_tags` is empty, fallback computes a single-entry vector from `repository_type` (the legacy singular field).
- Post-migration backfill: a one-shot Rust helper iterates projects with empty `root_path`, looks up the first member repo, and writes the repo's `path` as `root_path`. Similarly backfills `main_agent` from the first repo's `mainOwnerAgentName`. Idempotent: only writes when fields are empty.
- 4 new Tauri commands:
  - `update_project_root_path(id, rootPath: String) -> StoredProject`
  - `update_project_sdd_mode(id, sddMode: String) -> StoredProject` (validates `"wise_trellis" | "project_owned"`)
  - `update_project_main_agent(id, mainAgent: Option<String>) -> StoredProject`
  - `update_repository_role_tags(id, roleTags: Vec<String>) -> StoredRepository` (validates each tag is a non-empty trimmed string after normalization)

### Frontend

- `src/types.ts`:
  - `Project` adds `rootPath: string`, `sddMode: SddMode`, `mainAgent?: string | null`.
  - `Repository` adds `roleTags?: string[]`.
  - `SddMode` becomes `"wise_trellis" | "project_owned"`.
- `src/services/repository.ts` adds the 4 service wrappers.
- New pure helper module `src/utils/projectRepositoryRoles.ts` (or extend an existing utils):
  - `getRoleTags(repo: Repository): string[]` — returns `roleTags` if non-empty, else `[repositoryType]`, else `[]`.
  - `getEffectiveRepoSddMode(repo: Repository, projects: ProjectItem[]): SddMode` — finds the project that owns the repo and returns its `sddMode`. Falls back to `repo.sddMode` (treating legacy `"auto"`/`"off"`) only when no project owns this repo, otherwise returns `"wise_trellis"` as a safe default.
- `src/hooks/useMonitorOverview.ts`:
  - `buildRepositoryMemberMonitorItems` accepts `projects: ProjectItem[]` and consults `getEffectiveRepoSddMode` instead of `repo.sddMode`.
  - The hook call site passes through the projects array.

### Spec & docs

- `.trellis/spec/frontend/quality-guidelines.md` §3 updates: replace "Repository identity is `ownerKind: \"repository\"` plus `ownerRepositoryId`; do not encode repositories as `EmployeeItem`" with the project-level contract — `Project.sddMode` decides whether a repo is shown as a wise-Trellis member; `Repository.roleTags` is the routing taxonomy; `Repository.repositoryType` is read-deprecated.

## Acceptance Criteria (final)

- [ ] `bun test` passes with new focused tests:
  - `getRoleTags` returns array fallback from legacy `repositoryType`.
  - `getEffectiveRepoSddMode` returns project sddMode when repo is in a project.
  - `buildRepositoryMemberMonitorItems` keys off project sddMode when a project is supplied.
- [ ] `cargo check` clean inside `src-tauri/`.
- [ ] Migration runs idempotently (re-running on an already-migrated DB is a no-op; ALTER TABLE rejected with "duplicate column" is caught and skipped per existing migration framework).
- [ ] After upgrade, the wise project record auto-backfills `rootPath = "/Users/starlight/Documents/wise"` and (if wise repo has `mainOwnerAgentName`) `mainAgent` from that field. Verified by reading SQLite directly OR by running the app once and inspecting the returned `StoredProject`.
- [ ] No EmployeeItem UI changes in this commit (those land in Y).
- [ ] `RepositoryMemberMonitorItem` still renders for the wise project (project sddMode = `wise_trellis`, so behavior is unchanged).

## Definition of Done

- Tests added (above).
- Lint / typecheck (`bunx tsc --noEmit`) and `cargo check` green.
- `.trellis/spec/frontend/quality-guidelines.md` §3 updated to match the new contract.
- No new external dependencies.
- Commit hygiene: split into 3 commits — (1) Rust schema + types + commands, (2) Frontend types + helpers + tests, (3) hook update + spec doc update.
- Rollback plan: revert is safe because the legacy fields are preserved and new fields default to no-op values.

## Out of Scope (explicit, final)

- Path Y (main session, `@`-mention routing) — separate task.
- `RoleTagsEditor` component, project settings page, conditional `EmployeeItem` UI hide.
- Workflow template composer adjustments.
- DingTalk inbound / scheduled task runner rewiring.
- Deleting legacy `Repository.repositoryType` / `Repository.sddMode` columns (read-deprecated only this round).
- `mainOwnerAgentName` deprecation.

## Implementation Plan

### Commit 1 — Rust schema + types + commands
1. Add `src-tauri/migrations/016_project_trellis_root.sql` with the three ALTER TABLE statements.
2. Register `MIGRATION_016` in `wise_db.rs:20-33` and the `MIGRATIONS` slice at `wise_db.rs:47-108`.
3. Extend `WiseProjectRow` (`wise_db.rs:112-120`) with `root_path`, `sdd_mode`, `main_agent`.
4. Update `list_projects` (`wise_db.rs:403-455`) to select the new columns and populate the row.
5. Add db methods: `update_project_root_path`, `update_project_sdd_mode`, `update_project_main_agent`. Each updates `updated_at` and returns the new row.
6. Add `StoredProject` fields `rootPath`, `sddMode`, `mainAgent` in `app_state_commands.rs`. Add `role_tags: Vec<String>` to `StoredRepository` with serde default and validate-on-write.
7. Add `#[tauri::command]` functions: `update_project_root_path`, `update_project_sdd_mode`, `update_project_main_agent`, `update_repository_role_tags`. Pattern matches `update_repository_icon_display` (`app_state_commands.rs:362`).
8. Add a one-shot post-migration backfill function called from `list_projects` (or before returning): iterate rows with empty `root_path`, look up first member repo, write back. Same for `main_agent`. Use `update_project_root_path` internally so timestamps update once.
9. Register handlers in `lib_impl.rs` via `generate_handler!`.
10. `cargo check` clean.

### Commit 2 — Frontend types + helpers + tests
1. Update `src/types.ts`: add `rootPath`, `sddMode`, `mainAgent` to `ProjectItem`; add `roleTags?` to `Repository`; narrow `SddMode` enum.
2. Add `src/utils/projectRepositoryRoles.ts` with `getRoleTags` + `getEffectiveRepoSddMode`.
3. Add `src/utils/projectRepositoryRoles.test.ts` with bun:test coverage:
   - `getRoleTags` returns explicit array.
   - `getRoleTags` falls back to `[repositoryType]` when array is empty/missing.
   - `getRoleTags` returns `[]` when neither is set.
   - `getEffectiveRepoSddMode` returns project sddMode when repo is in a project.
   - `getEffectiveRepoSddMode` falls back to `wise_trellis` default when repo is in no project.
4. Add service wrappers in `src/services/repository.ts`: `updateProjectRootPath`, `updateProjectSddMode`, `updateProjectMainAgent`, `updateRepositoryRoleTags`.
5. `bunx tsc --noEmit` clean.

### Commit 3 — Hook update + spec doc
1. Update `buildRepositoryMemberMonitorItems` (`useMonitorOverview.ts:194-272`) to accept `projects: ProjectItem[]` and use `getEffectiveRepoSddMode`.
2. Update call site (likely `useMonitorOverview` itself near `useMonitorOverview.ts:412`) to pass `projects` through.
3. Update `useMonitorOverview.test.ts` tests that set `sddMode: "wise_trellis"` on a repo to instead set it on the project.
4. Update `.trellis/spec/frontend/quality-guidelines.md` §3 with the new contract text.
5. `bun test` green.

## Technical Notes

### Files inspected during brainstorm

- `src/types.ts` — `ProjectItem`, `Repository`, `EmployeeItem`, `RepositoryMemberMonitorItem`, `SddMode`.
- `src-tauri/src/app_state_commands.rs` — `StoredProject`, `StoredRepository`, persistence shape.
- `src-tauri/src/wise_paths.rs` — `wise_dir()`, project/repo/tabs JSON paths.
- `src/services/workflow/trellisAdapter.ts` — confirms repo-scoped execution metadata.
- `src/services/workflow/index.ts` — adapter registry wiring (unchanged by this task).
- `src/hooks/useMonitorOverview.ts` — repository member synthesis from `sddMode === "wise_trellis"`.
- `src/services/trellis/sddModeDetector.ts` — auto-resolution rules (will move to project scope).
- `.trellis/spec/frontend/quality-guidelines.md` §3 — current contract this task evolves.

### Decision (ADR-lite) — Q1: Project root semantics

**Context**: Wise needs to host `.trellis/` somewhere when a project has multiple repos. Three candidates existed: (a) independent project root, (b) common ancestor of repos, (c) wise-managed `~/.wise/projects/<id>/`. The choice drives schema, project-creation UX, and whether spec is git-shareable.

**Decision**: Project root is independent. `Project.rootPath` is a first-class field. `.trellis/` always lives at `<rootPath>/.trellis/`. Repository paths are unrelated to `rootPath` — repos can sit inside, outside, or at any location on disk; only the project knows where its SDD root is.

**Consequences**: 
- Spec is git-shareable (user can `git init` the project root, or it can be its own repo).
- Wise's own project naturally lands at `rootPath = /Users/starlight/Documents/wise`, which is also a repo path — the single-repo degenerate case is transparent.
- Project creation needs a directory picker step.
- SQLite migration adds `root_path TEXT` to projects table; existing rows backfill from the first member repo's path (deferred to Q3).
- Repositories can be added to a project without copying or moving files — only their absolute paths are recorded.

### Research References

(None yet — this task is mostly structural; no external library/protocol research needed.)
