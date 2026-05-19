# Skills three-tier source model

## Goal

Refactor wise's skill model so every skill carries an explicit
`source: 'builtin' | 'custom' | 'extension'` field, and the renderer ships a
unified Skills Hub UI (search + filter + import) that surfaces skills from
all three sources. Add support for importing skills from external skill
directories (`~/.claude/skills/`, `~/.codex/skills/`, etc.) via filesystem
copy or symbolic link.

## Background

AionUi (`AionUi-main/src/renderer/pages/settings/SkillsHubSettings.tsx`)
treats skills as a 3-tier model:

- `_source: 'builtin' | 'custom' | 'extension'` distinguishes origin.
- Source-tab UI lets users browse external skill paths (Claude, Codex,
  Goose, etc.) and import via copy or symlink.
- IPC channels `fs.listAvailableSkills`, `fs.importSkill`,
  `fs.importSkillWithSymlink`, `fs.scanForSkills`,
  `fs.detectCommonSkillPaths`, `fs.exportSkillWithSymlink`,
  `fs.deleteSkill`, `fs.addCustomExternalPath`, `fs.removeCustomExternalPath`.

wise current state:

- `src-tauri/src/skills_sh.rs` discovers skills but has no `source`
  concept.
- Renderer skill surfaces (under `src/components/`) treat all skills as
  uniform; there is no Hub UI.
- No support for external paths; no symlink import.

## Requirements

### R1 — Backend `source` field

- Update the skill record returned by `skills_sh.rs` (or its successor) to
  include:
  - `source: 'builtin' | 'custom' | 'extension'`.
  - `extensionId?: string` — populated when `source === 'extension'`.
  - `location: string` — absolute path on disk.
  - `isSymlink: bool` — true when the skill entry is a symbolic link.
- "builtin" = ships with the wise binary or is auto-injected from a
  `_builtin/` directory.
- "custom" = user-imported under `~/.wise/skills/` (the canonical user
  dir; create if missing).
- "extension" = sourced from a loaded extension (will be populated by
  the extension task once integration lands; for this task, leave the
  branch in place returning empty).

### R2 — External path scanner

- Detect common skill paths automatically:
  - `~/.claude/skills/`
  - `~/.codex/skills/`
  - `~/.goose/skills/`
  - `~/.gemini/skills/`
  - User-added paths (persisted in SQLite, see R3).
- Tauri command `skills_detect_external_paths()` returns the list with a
  per-path `count` of detected skills.
- Tauri command `skills_scan_path(path)` returns the skills under a
  specific path without importing them.

### R3 — Custom external paths persistence

- New table `skills_external_path`:
  ```
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  added_at     TEXT NOT NULL
  ```
- Tauri commands:
  - `skills_add_external_path(path)`.
  - `skills_remove_external_path(id)`.
  - `skills_list_external_paths()`.

### R4 — Import flows

- `skills_import_copy(sourcePath)` — copies the skill directory into
  `~/.wise/skills/<name>/`, creates a `custom`-source record.
- `skills_import_symlink(sourcePath)` — creates a symlink instead. Records
  `isSymlink: true`.
- Both reject if the destination name already exists; surface a structured
  conflict error.

### R5 — Delete + export

- `skills_delete(id)` — only allowed for `custom` source. `builtin` and
  `extension` deletes return an error.
- `skills_export_symlink(id, destPath)` — creates a symlink in `destPath`
  pointing at the skill location, so other tools can pick it up.

### R6 — Renderer SkillsHub component

- Single component: `src/components/SkillsHub/SkillsHub.tsx` (split into
  smaller subcomponents per project structure rules).
- Two top-level tabs:
  1. **My Skills** — filter `source === 'custom' || source === 'builtin'`.
  2. **Extension Skills** — filter `source === 'extension'`.
- Search bar with fuzzy match across name + description.
- Source-tab subview ("Browse external") listing detected paths with
  counts; clicking a path shows skills under it with import buttons
  (copy / symlink).
- "Add external path" button → directory picker → persist via R3.
- Per-skill row: avatar (deterministic color from name hash, mirroring
  AionUi line 26-41), name, description, source badge, location, delete
  (custom only).

### R7 — Tests

- Rust unit tests for:
  - Source classification: skills under `~/.wise/skills/` are `custom`;
    skills under `_builtin/` are `builtin`; extension branch returns
    empty (placeholder until extension task integrates).
  - Symlink detection (`isSymlink: true` on a symlinked entry).
  - Import-copy and import-symlink against a tmpdir.
  - Conflict detection on duplicate name.
- Frontend unit test for the SkillsHub component covering search +
  filter + at least one import flow (mocked `invoke`).

## Constraints

- Backwards-compatible. Existing skill records continue to be
  discoverable; the `source` field defaults to `custom` if a record's
  origin can't be classified, with a warning logged.
- Do not change skill-execution semantics. This task is purely about
  cataloging and import.
- Extension-source skills are placeholders until the extension task
  integrates; do not invent a fake extension just to populate the branch.
- Symlink creation requires per-OS handling — implement on macOS first
  (current dev OS), guard Windows behind a feature flag or stub error.
- No `localStorage` for skill state.
- English source.

## Acceptance Criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml skills` passes.
- [ ] `bun test src/components/SkillsHub` passes.
- [ ] Dropping a skill folder into `~/.claude/skills/` and clicking
      "Browse external" lists it; clicking "Import (symlink)" creates a
      symlink under `~/.wise/skills/` and the new skill appears under
      "My Skills" with `isSymlink: true`.
- [ ] Deleting a custom skill removes both the DB record and the
      filesystem entry (or symlink).
- [ ] Builtin skills are returned with `source: 'builtin'` and cannot be
      deleted via `skills_delete`.
- [ ] Adding an external path persists across restart.
- [ ] No regression in existing skill consumers (whatever currently reads
      `skills_sh.rs` output continues to work — the `source` field is
      additive).

## Out of Scope

- Skill execution / runtime semantics.
- Extension-source population (waits on extension task).
- Skill versioning / updates.
- Cross-extension skill name collision rules (extension task owns this).
- Windows-specific symlink permission handling beyond a stub error.

## Notes

- AionUi `SkillsHubSettings.tsx` is the visual reference for the Hub UI.
  Do not copy verbatim — wise uses Ant Design, not Arco.
- Design and implement docs must be filled before `task.py start`.
