# Composer @-Mention Popover for Project Role Tags (v2)

## Goal

Surface the project's available `roleTags` in the composer's `@`-mention popover. When the user types `@` and the active project is `wise_trellis`, the popover prepends a roleTag row per distinct tag aggregated from member repositories. Selecting a roleTag inserts `@<tag> ` into the editor, which the existing `planAtMentionDispatch` (path Y) then routes to the matched repositories on submit.

When the active project is `project_owned` (or no project), the popover keeps its current behavior unchanged (employees + teams + files).

## What I Already Know

- The composer already detects the `@` trigger via `reportAtSlashTriggerFromPlain` and shows `<SlashPopover>` with `trigger.mode === "at"` (`src/components/ClaudeChatInput/composer-region.tsx:1740-1765`).
- `SlashPopover` accepts `employeeOptions` and `teamOptions` for the `at` mode and composes the result list in `getFilteredOptions` (`src/components/ClaudeChatInput/slash-popover.tsx:606-651`).
- On selection, `at`-mode options run through `insertPlainAt` + `ensureSpaceAfterAtInsert` to inject `@<name> ` at the cursor (`slash-popover.tsx:305-318`). The roleTag flow reuses these helpers verbatim.
- `getRoleTags(repo)` exists from path X to read multi-tag arrays with legacy `repositoryType` fallback.
- Path Y's `planAtMentionDispatch` already handles `@<roleTag>` parsing case-insensitively, so the popover only needs to produce well-formed strings.
- The active project lookup happens in AppImpl via `activeProjectId` + `projects.find`. Passing the active project + repositories into `composer-region` is already wired indirectly through several props.

## Scope (Z-v2 MVP)

### In scope

1. New pure helper `buildProjectRoleTagOptions(activeProject, repositories)` → `Array<RoleTagOption>` deduplicated, case-insensitively grouped, each entry carrying the original tag (preserving casing of the first occurrence) plus the list of repo names it covers and the repo count.
2. `SlashOption` gets a new variant `{ type: "roleTag", label, name, description, repoCount, repoNames }`. Existing variants untouched.
3. `getFilteredOptions` prepends roleTag rows in `at` mode when the new optional prop is provided. RoleTags are filtered by the active query like other rows.
4. `SlashPopover` renders roleTag rows with a clear icon/badge (e.g. `#frontend · 1 repo` or `· 2 repos`) so they're distinguishable from employee rows.
5. On click, the existing `at` insertion branch handles roleTag identically to agent/team (insert `@<name> `).
6. In `composer-region.tsx`, accept a new prop `projectRoleTagOptions: RoleTagOption[]` and thread it through to `<SlashPopover>`.
7. In `AppImpl.tsx`, compute the option list via `buildProjectRoleTagOptions(activeProject, repositories)` and inject into the composer prop pipeline.
8. When `activeProject.sddMode === "wise_trellis"`, hide employees from the popover (matching the Q5 contract from X). Teams are kept since teams aren't EmployeeItem-flavored.
9. Focused tests for `buildProjectRoleTagOptions`.

### Out of scope (deferred)

- Free-form custom-tag input inside the popover.
- Inline preview chips in the editor body showing matched repo names.
- Mouse hover preview of which repos a tag covers (the description string is enough).
- Settings UI for editing repo roleTags (separate follow-up task).
- Showing project members (repository names) directly in the popover — only roleTags surface; repo specificity is implied via the description text.

## Requirements (final)

### Pure helper

- `src/utils/projectRoleTagOptions.ts`:
  - `interface RoleTagOption { tag: string; label: string; description: string; repoCount: number; repoNames: string[]; }`
  - `buildProjectRoleTagOptions(project: ProjectItem | null | undefined, repositories: ReadonlyArray<Repository>): RoleTagOption[]`
  - Returns `[]` when `project == null` or has no member repos.
  - Aggregates tags from all member repos via `getRoleTags`. Deduplicates case-insensitively, preserving the original casing of the first occurrence.
  - For each tag, lists the repo names that carry it (in input order) and provides a Chinese description like `匹配 N 个仓库: a, b`.
  - Sorted: most-covering tags first, then alphabetically. Cap at 32 entries (defensive — UI safety only).

### SlashPopover types + filtering

- `SlashOption` adds `{ type: "roleTag"; label: string; name: string; description?: string; repoCount?: number; repoNames?: string[] }`.
- `SlashPopoverProps` adds `projectRoleTagOptions?: RoleTagOption[]` and `hideEmployeesInAtMode?: boolean`.
- `getFilteredOptions` prepends roleTag entries in `at` mode (after query filter). When `hideEmployeesInAtMode` is true, agent (employee) rows are dropped from the result.
- The render row reuses the existing layout: tag label + description text. A small `#` glyph prefix or `· N repo(s)` suffix distinguishes the roleTag rows from agents/teams.

### Composer wiring

- `composer-region.tsx` `Props` add `projectRoleTagOptions?: RoleTagOption[]` and `hideEmployeesInAtMode?: boolean`. Thread to `<SlashPopover>`.
- `AppImpl.tsx` derives both props near the existing `mentionEmployees` memo, using `buildProjectRoleTagOptions(activeProject, repositories)` and `shouldHideEmployeeUi(activeProject)`.

### Tests

- `src/utils/projectRoleTagOptions.test.ts`:
  - aggregates tags from multiple repos
  - case-insensitive dedup with original-casing preservation
  - empty when project missing or has no repos
  - sorted by coverage descending then alphabetically
  - respects legacy `repositoryType` fallback via `getRoleTags`
  - caps at 32 entries

## Acceptance Criteria

- [ ] `bun test` passes with new focused tests.
- [ ] `bunx tsc --noEmit` clean.
- [ ] `cargo check` unchanged (no Rust changes).
- [ ] When project is wise_trellis with repos tagged `["frontend"]` and `["backend"]`, typing `@` shows two roleTag rows; selecting `frontend` inserts `@frontend ` into the editor.
- [ ] When project is project_owned, the popover renders unchanged from previous behavior.
- [ ] Commit hygiene: single commit (helper + types + popover wiring + composer wiring + AppImpl wiring + tests).

## Definition of Done

- Tests added.
- Lint / typecheck green.
- No new external dependencies.
- No spec contract change (existing §3 already covers @-mention dispatch; popover is a UI consumer that conforms to it).

## Implementation Plan (single commit)

1. Add `src/utils/projectRoleTagOptions.ts` + tests.
2. Extend `SlashOption` and `SlashPopoverProps` in `slash-popover.tsx`; update `getFilteredOptions` + click handler + row render.
3. Add prop pipeline in `composer-region.tsx`.
4. Add `buildProjectRoleTagOptions` call + `hideEmployeesInAtMode` flag wiring in `AppImpl.tsx`.
5. `bun test` + `bunx tsc --noEmit` green.

## Technical Notes

### Decision (ADR-lite) — Single-pass extension, no separate popover

**Context**: We could (a) extend the existing `SlashPopover` to host the new roleTag rows, or (b) introduce a dedicated `@-mention` popover renderer.

**Decision**: Option (a). The existing popover already supports the `at` trigger mode, query filtering, keyboard nav, click handler, and insertion plumbing. Splitting would force us to duplicate or refactor those concerns.

**Consequences**: 
- One file (`slash-popover.tsx`) absorbs a new `SlashOption` variant plus prop additions.
- Future iterations (e.g. roleTag autocomplete with rich hover preview) can fork the row renderer without touching insertion logic.
- The popover stays under its current size budget; new logic is contained to the option-builder + one render branch.