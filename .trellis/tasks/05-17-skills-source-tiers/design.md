# Design — Skills three-tier source model

## 1. Boundaries

**In scope (write):**
- `src-tauri/src/skills/mod.rs` (new module re-exporting submodules)
- `src-tauri/src/skills/source.rs` (new — `SkillSource`, classifier, external scanner)
- `src-tauri/src/skills/external_paths.rs` (new — SQLite CRUD for user-added paths)
- `src-tauri/src/skills/import.rs` (new — copy + symlink import flows)
- `src-tauri/src/skills/commands.rs` (new — Tauri commands)
- `src-tauri/migrations/<NNN>_skills_external_path.sql` (new; numeric prefix
  picked at execution time after surveying current migrations)
- `src-tauri/src/wise_db.rs` (one new `MIGRATION_NNN` const + entry in
  `MIGRATIONS` list)
- `src-tauri/src/lib.rs` (`mod skills;`)
- `src-tauri/src/lib_impl.rs` (use stmt + handler registration)
- `src-tauri/src/claude_commands/project_skills.rs` (additive only — extend
  the existing `ClaudeProjectSkill` struct with `source` and `is_symlink`
  fields)
- `src/types.ts` (extend `ClaudeProjectSkill` interface to mirror new fields)
- `src/services/skills.ts` (new — wrappers for new commands)
- `src/services/skills.test.ts` (new)
- `src/components/SkillsHub/SkillsHub.tsx` (extend with source filter +
  "Browse external" tab; preserve existing skills.sh search behavior)

**Out of scope:**
- Skill *execution* semantics. The three-tier model is metadata only.
- Refactor of existing `ProjectSkillsPanel.tsx` (remains the file CRUD
  surface; SkillsHub remains the registry-search surface).
- Cross-extension skill name collision rules (extension task owns this).
- Plugin cache skills already returned by
  `list_claude_plugin_cache_skills` — those keep their current shape;
  classifier maps them to `source: 'builtin'` because the plugin cache is
  Claude-managed, not user-managed.

## 2. Source classification

Three values, plus an optional `extensionId`:

```rust
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SkillSource {
    Builtin,
    Custom,
    Extension,
}
```

Classifier (`src-tauri/src/skills/source.rs::classify`):
- Path under `<repo>/.claude/skills/` → `Custom` (per-repo user skill).
- Path under `~/.claude/skills/` → `Custom` (user-global).
- Path under `~/.claude/plugins/cache/<plugin>/skills/` → `Builtin`
  (Claude-managed; user cannot delete via wise).
- Path under `~/.wise/skills/` → `Custom` (wise-imported).
- Path under a loaded extension's directory → `Extension(extensionId)`.
  Resolution order: ask `extensions::ExtensionRegistry` (Task 3) for the
  `skills()` list and match by `location` prefix.
- Anything else → `Custom` (with a `classifier_warning` field surfaced
  to the UI for diagnostics).

`is_symlink` is computed via `std::fs::symlink_metadata().file_type().is_symlink()`.

## 3. External path scanner

Default detection set (read-only, hard-coded):

```rust
const DEFAULT_EXTERNAL_PATHS: &[&str] = &[
    "~/.claude/skills",
    "~/.codex/skills",
    "~/.gemini/skills",
    "~/.goose/skills",
];
```

User-added paths persist in SQLite (table `skills_external_path`):

```sql
CREATE TABLE IF NOT EXISTS skills_external_path (
    id        TEXT PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    added_at  TEXT NOT NULL
);
```

`skills_detect_external_paths` returns each candidate dir + a probe `count`
of how many skill-shaped subdirectories live there (a "skill-shaped"
subdir is one containing `SKILL.md` per Claude convention OR
`skill.md` per wise/extension convention).

`skills_scan_path(path)` lists skills under one path *without importing*
them. Returns an array of `{ name, location, isSymlink, hasSkillMd }`.

## 4. Import flows

`skills_import_copy(source_path) -> Result<ImportedSkill, String>`:
- Validate `source_path` exists and is a directory.
- Determine destination name = source dir basename.
- Refuse if `~/.wise/skills/<name>/` already exists (returns
  structured `Conflict { existing_path }`).
- Create `~/.wise/skills/`, then `fs::copy_dir_recursive(source, dest)`
  (helper local to module — `walkdir` already in deps).
- Return `{ name, location, source: 'custom', isSymlink: false }`.

`skills_import_symlink(source_path)`:
- macOS / Linux: `std::os::unix::fs::symlink(source, dest)`.
- Windows: returns `Err("symlink import requires elevated privileges on Windows")`
  — feature-flagged stub.
- Returns `{ name, location, source: 'custom', isSymlink: true }`.

## 5. Delete + export

`skills_delete(id) -> Result<(), String>`:
- Look up by id (synthesized from `<source>:<name>`).
- Allow only `source === 'custom'`. Reject `builtin` and `extension`.
- If `isSymlink` → `fs::remove_file`. Else → `fs::remove_dir_all`.

`skills_export_symlink(id, dest_path)`:
- Resolve location.
- Reject if `dest_path` already exists.
- Symlink (Unix only — same Windows guard).

## 6. Existing-API additions (additive)

`ClaudeProjectSkill` (in `claude_commands/project_skills.rs`) gets two
new serde-`camelCase` fields:

```rust
#[serde(default)]
pub source: Option<SkillSource>,    // None means "not classified yet"
#[serde(default)]
pub is_symlink: bool,
```

The three existing list commands (`list_claude_project_skills`,
`list_claude_user_skills`, `list_claude_plugin_cache_skills`) populate
these fields by calling `skills::source::classify`. Behavior preserved:
the field is **additive**, defaulted on the TS side via `??`.

`src/types.ts` `ClaudeProjectSkill` interface gains the same two fields
as optionals (so older callers don't break).

## 7. Tauri commands

| Command | Args | Returns |
|---|---|---|
| `skills_detect_external_paths` | — | `Vec<DetectedExternalPath { id?, path, count }>` |
| `skills_scan_path` | `{ path }` | `Vec<ScannedSkill>` |
| `skills_add_external_path` | `{ path }` | `DetectedExternalPath` |
| `skills_remove_external_path` | `{ id }` | `()` |
| `skills_list_external_paths` | — | `Vec<DetectedExternalPath>` |
| `skills_import_copy` | `{ sourcePath }` | `ImportedSkill` |
| `skills_import_symlink` | `{ sourcePath }` | `ImportedSkill` |
| `skills_delete` | `{ id }` | `()` |
| `skills_export_symlink` | `{ id, destPath }` | `()` |

All payloads `#[serde(rename_all = "camelCase")]`. Errors `Result<T, String>`.

## 8. Renderer integration

`SkillsHub.tsx` is extended with:

- A second top-level Segmented control: `Browse registry | Browse external`
  (default `registry`). Existing skills.sh search lives under `registry`.
- Under `Browse external`:
  - List of detected paths (default + persisted) with per-path counts.
  - Selecting a path lists skills with `Import (copy)` and `Import (symlink)`
    buttons per row.
  - "Add path" button → directory picker → `skills_add_external_path`.
- Existing installed-skills section gains a `source` badge.

Visual changes are bounded — no rewrite of `ClaudeCodeToolsPanel` or
`ProjectSkillsPanel`. Those continue to use the existing `claude.ts`
helpers; they get the new `source` / `isSymlink` fields automatically.

## 9. Tests

**Rust unit tests** (`src-tauri/src/skills/...`):
- `source::tests` — classifier maps every fixture directory correctly
  (under `tempdir`, no real `~/.claude` access).
- `external_paths::tests` — SQLite CRUD round-trip against
  `Connection::open_in_memory()`.
- `import::tests` — copy + symlink against a tmpdir source, conflict
  detected on duplicate name.

**Frontend tests** (`bun:test`):
- `src/services/skills.test.ts` — mock `invoke`; verify each wrapper
  hits the right command name and argument shape.
- No new SkillsHub UI test in this task; existing AuthorPanel test
  already stubs SkillsHub via `mock.module`.

## 10. Migration ordering

Pick the next free numeric prefix at execution time. As of survey, Codex
took `023_agent_custom.sql`; Task 2 (MCP) will take the next one if it
runs first. Implementer:

1. `ls src-tauri/migrations/` to find the highest numeric prefix.
2. Use prefix N+1.
3. Add the include + entry to `wise_db.rs` `MIGRATIONS`.

## 11. Risk register

| Risk | Mitigation |
|---|---|
| Existing `ClaudeProjectSkill` callers break on new fields | Mark fields `#[serde(default)]` and TS-side optional. |
| Symlink permission on Windows | Feature-gated; returns structured error. |
| `~/.claude/skills` symlink loops | `walkdir::WalkDir::new(...).follow_links(false)` for the scanner. |
| Plugin cache classification surprise | Documented in §2: plugin cache → `Builtin`. |
| Migration prefix collision with Task 2/Codex | Survey-then-pick at execution; document chosen prefix in implement.md before edit. |
| Race with extension task on `extension` source | Until Task 3 lands, `extension` source is never produced; classifier just falls through to `custom`. |
| Recursive copy slow on huge skill dirs | Document a 200MB cap in `skills_import_copy`; abort with `Conflict { reason: 'too_large' }` if exceeded. |

## 12. Compatibility / rollback

- Existing `ProjectSkillsPanel` and SkillsHub registry search stay
  functional throughout the refactor.
- Rollback = revert the new files + the `ClaudeProjectSkill` struct
  fields + the migration. Existing rows are unaffected.

## 13. Open decisions

- **Custom skill home dir**: `~/.wise/skills/` (created lazily on first
  import). Rejected: living inside Claude's `~/.claude/skills/` would
  make wise responsible for skills it doesn't own. Documented in §4.
- **Plugin cache classification**: `Builtin`, not `Custom`. Rejected:
  treating Claude-managed dirs as deletable risks data loss.
