# Persistence and Migrations

> SQLite, JSON settings, schema migrations, and durable writes.

---

## Persistence Ownership

Durable application state belongs in Rust-managed persistence, not scattered
frontend storage.

Use:

- SQLite in `~/.wise/wise.db` for structured durable state.
- `app_settings` for generic key/value settings.
- Domain tables for projects, workflows, task snapshots, graph data, messages, and mappings.
- Existing JSON files only for legacy or intentionally file-backed state.

Frontend services should expose typed operations over this persistence layer.

---

## SQLite Access

`src-tauri/src/wise_db.rs` owns database opening and migrations. It enables
foreign keys and wraps the connection in managed state.

Rules:

- Use parameterized SQL with `params!`.
- Keep DB errors converted into `Result<T, String>`.
- Keep row DTOs serializable with `#[serde(rename_all = "camelCase")]`.
- Keep transactions explicit when a command updates multiple related tables.
- Preserve foreign key behavior.
- Avoid holding the DB lock while doing unrelated filesystem or process work.

---

## Migrations

Migrations live in `src-tauri/migrations/` and are included from Rust.

The current numeric range is `001_init.sql` through `022_trellis_runtime.sql`,
plus the JSON seed `005_platform_split_prompt_seed.json`. The include list and
runner live in `src-tauri/src/wise_db.rs`; new files must be wired in there as
well as added to disk.

Rules:

- Add new migrations with the next numeric prefix.
- Never edit an already-applied migration to change production behavior.
- Keep migrations idempotent where practical.
- Backfill data explicitly when adding non-null or derived columns.
- Update the migration include list and runner in `wise_db.rs`.
- Keep seed data versioned; JSON seed files must have a stable schema.

---

## JSON Settings

JSON stored in `app_settings`, files, or graph/task blobs must be treated as
versioned external data.

- Include a `schemaVersion` when the shape may evolve.
- Validate shape before using it as a typed object.
- Tolerate missing optional fields from older versions.
- Migrate legacy keys after successful import, as `useRepositoryList.ts` does
  for legacy project state.
- Do not persist raw UI drafts unless the product expects recovery.

---

## Scenario: Project Root Auto-Detection

### 1. Scope / Trigger

- Trigger: project creation, project/repository linking, PRD splitting, and main-session anchoring all depend on `Project.rootPath`.
- Applies to Tauri commands that create or return `StoredProject`.

### 2. Signatures

- `create_project(name, iconDisplayName, iconColor, rootPath?: string | null) -> StoredProject`
- `add_repository_to_project(projectId: string, repositoryId: i64) -> StoredProject`
- `resolve_project_root_from_repository(repositoryPath: string) -> Option<String>`
- Helper: `find_trellis_project_root_from_path(path: &str) -> Option<PathBuf>`

### 3. Contracts

- `find_trellis_project_root_from_path` accepts only non-empty absolute paths that exist on disk.
- Root detection canonicalizes the input path, then walks ancestors until it finds `.trellis/scripts/task.py`.
- `create_project` treats `rootPath` as path context, not a trusted persisted value; it stores the resolved Trellis root only when the helper succeeds.
- `add_repository_to_project` is the authoritative mutation: after linking, if the project has an empty `root_path`, it resolves from all linked repository paths and returns the updated `StoredProject`.
- `list_projects` may backfill legacy empty `root_path` rows from existing linked repositories. This keeps old projects usable in PRD splitting without a separate settings step.

### 4. Validation & Error Matrix

- Empty project name -> `项目名称不能为空`.
- Empty or relative root context -> root detection returns `None`; project creation still succeeds with empty `rootPath`.
- Missing path on disk -> root detection returns `None`; no persistence write is attempted.
- Existing path with no Trellis ancestor -> root detection returns `None`; project remains unrooted.
- Unknown project during repository link -> `项目未找到`.

### 5. Good/Base/Bad Cases

- Good: `/work/app/frontend` exists and `/work/app/.trellis/scripts/task.py` exists -> resolved root is `/work/app`.
- Base: name-only project creation -> no root context, empty `rootPath`, later repository link can backfill.
- Bad: persisting a repository path directly as `root_path` when the Trellis directory lives in a parent.
- Bad: frontend ignoring the returned `StoredProject` from `add_repository_to_project`.

### 6. Tests Required

- Frontend service/hook tests or pure helper tests must cover selected floating repo as the only automatic project seed.
- Rust coverage should be added when command-level harnesses exist: nested repo path, exact Trellis root path, missing path, and no-Trellis path.
- Type checks must catch the `addRepositoryToProject` return contract when call sites still treat it as `void`.

### 7. Wrong vs Correct

#### Wrong

```rust
if project.root_path.is_empty() {
    db.update_project_root_path(&project_id, repo.path.trim(), now_ms)?;
}
```

#### Correct

```rust
if project.root_path.is_empty() {
    if let Some(root) = find_trellis_project_root_from_path(&repo.path) {
        db.update_project_root_path(&project_id, &root.to_string_lossy(), now_ms)?;
    }
}
```

---

## Scenario: Builtin Assistant Runtime Bundles

### 1. Scope / Trigger

- Trigger: adding or changing a Wise builtin assistant, default skill bundle,
  default MCP bundle, or assistant override merge behavior.
- Applies to `src-tauri/src/assistants/builtins/*`,
  `assistants_list`, `assistants_resolve_runtime`, and the frontend
  `AssistantSettingsDrawer`.

### 2. Signatures

- `BuiltinAssistantBundle { assistant_id, name, description, engine_id,
  system_prompt, tools, default_workflows, default_skills, default_mcps,
  default_prompt_layers }`
- `BuiltinSkillRef { id, label, source_path }`
- `assistants_list() -> Vec<AssistantEntry>`
- `assistants_resolve_runtime({ assistantId, projectId?, repositoryId? })
  -> ResolvedRuntime`
- `assistant_overrides.skill_bundle_json` and `mcp_bundle_json` use
  `{ disabled: string[], custom: [{ id, label, origin?, sourcePath? }] }`.
- Frontend skill mounting uses `skills_detect_external_paths()` and
  `skills_scan_path(path)` to choose existing local skills, then persists the
  selected skill as a full `custom` bundle item through
  `assistants_save_overrides`.

### 3. Contracts

- `default_workflows` are Wise product workflows such as Trellis PRD split.
  They are visible capabilities, not Claude/Codex skill injections.
- `default_skills` are assistant-mounted skill bundles. Word/PPT artifact
  assistants use this path for `officecli-docx` / `officecli-pptx`.
- Builtin assistant IDs are stable strings beginning with `builtin:`.
- Builtin skill `source_path` must be a Wise-owned stable resource path or a
  documented external source, never an untracked developer-machine absolute
  path.
- Runtime merge order remains builtin defaults -> assistant scope -> project
  scope -> repository scope. Bundle JSON object fields replace at the top
  level; callers that save overrides must send the complete intended bundle.
- Assistant settings UI may add/remove non-builtin skill refs, but builtin skill
  refs are only disabled/enabled. Removing a builtin by deleting it from
  `custom` is a bug because builtin refs come from the Rust bundle.

### 4. Validation & Error Matrix

- Empty assistant id when saving overrides -> backend rejects.
- Invalid override scope -> backend rejects.
- Invalid bundle JSON -> backend rejects.
- Unknown assistant id in runtime resolver -> returns legacy/minimal metadata,
  not a crash.
- Builtin assistant with neither workflow nor skill may be valid only for a
  pure prompt/template assistant; otherwise add at least one visible capability.

### 5. Good/Base/Bad Cases

- Good: `builtin:prd-split` exposes Trellis workflow refs and no default skill,
  because the main capability is Wise orchestration.
- Good: `builtin:word-doc` exposes `officecli-docx` in `default_skills` with a
  Wise resource `source_path`.
- Base: custom assistants start with empty workflow/skill/MCP defaults and users
  add bundles through overrides.
- Bad: showing "内置编排" for a Word/PPT skill bundle, because that hides the
  difference between workflow orchestration and skill mounting.
- Bad: saving a project override with only `{ disabled: [...] }` when the UI
  intends to preserve custom skill entries; bundle sections are top-level
  replacement objects.

### 6. Tests Required

- Builtin registry tests assert every new builtin is discoverable by id.
- Skill-backed builtin tests assert `default_workflows` is empty and the
  expected `default_skills` item exists when adding artifact assistants.
- Runtime resolver tests assert default skill bundle JSON includes builtin
  skill refs and that disabled/custom override payloads survive resolution.
- Frontend service tests assert `assistants_reset_overrides` and bundle JSON
  builders wrap payloads under `args`.
- Frontend pure helper tests assert scanned skill -> bundle candidate
  conversion, dedupe on add, remove behavior, and search filtering.

### 7. Wrong vs Correct

#### Wrong

```rust
BuiltinSkillRef {
    id: "officecli-docx",
    label: "OfficeCLI DOCX",
    source_path: "/Users/alice/AionUi-main/src/process/resources/skills/officecli-docx",
}
```

#### Correct

```rust
BuiltinSkillRef {
    id: "officecli-docx",
    label: "OfficeCLI DOCX",
    source_path: "src-tauri/resources/skills/officecli-docx",
}
```

---

## Atomic Writes

For durable file writes:

- Write to a temporary file in the same directory.
- Flush/write fully before replacing the target.
- Rename into place atomically when possible.
- Create parent directories intentionally.
- Avoid partial writes for files read on startup.

Use existing helpers such as `write_file_atomic` before adding another write path.

---

## Frontend Cache and Local Storage

Do not use `localStorage` for durable application records. It is acceptable only
for UI-only preferences or compatibility with an existing pattern.

If a setting affects repositories, tasks, workflows, Claude sessions, plugins,
or app startup behavior, persist it through a service backed by Rust/SQLite.

---

## Common Mistakes

- Editing old migrations instead of adding a new one.
- Saving stringified JSON without a validation path.
- Reading JSON with a direct type cast and no fallback.
- Updating several related tables without a transaction.
- Holding the SQLite mutex across slow filesystem or process operations.
- Creating a second persistence path for data already represented in `wise.db`.
