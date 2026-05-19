# Implement — Skills three-tier source model

Top-to-bottom checklist. Run **after** Codex's Task 1 has merged so
`lib_impl.rs` and `wise_db.rs` are stable.

## Step 0 · Re-baseline

- [ ] `ls src-tauri/migrations/` — record highest numeric prefix (e.g. `023`).
      Note the prefix this task will use (next free).
- [ ] `git log -- src-tauri/src/lib_impl.rs src-tauri/src/wise_db.rs`
      — confirm Codex's `agent_registry` changes have landed.
- [ ] Read `src-tauri/src/claude_commands/project_skills.rs` lines
      256-310 — confirm `ClaudeProjectSkill` struct and the three
      list_* commands.
- [ ] Read `src-tauri/src/skills_sh.rs` to understand the existing
      registry-search surface (untouched by this task).

Gate: prefix recorded, no edits yet.

## Step 1 · Migration

- [ ] Create `src-tauri/migrations/<NNN>_skills_external_path.sql`
      per design §3 schema.
- [ ] Add include + `MIGRATIONS` list entry in `wise_db.rs` (next
      adjacent slot — preserve numeric ordering).

Gate: `cargo build --manifest-path src-tauri/Cargo.toml` clean.

## Step 2 · `skills/source.rs`

- [ ] `pub enum SkillSource`, classifier `pub fn classify(path: &Path,
      registry: &ExtensionRegistry) -> (SkillSource, Option<String>)`.
- [ ] `pub fn is_symlink(path: &Path) -> bool`.
- [ ] Tests: classifier covers each fixture path (tempdir-based).

Gate: `cargo test --lib skills::source`.

## Step 3 · `skills/external_paths.rs`

- [ ] SQLite CRUD against the shared `Mutex<Connection>` from
      `wise_db`.
- [ ] Tests: round-trip via `Connection::open_in_memory()`.

Gate: `cargo test --lib skills::external_paths`.

## Step 4 · `skills/import.rs`

- [ ] `skills_import_copy_impl`, `skills_import_symlink_impl`,
      `skills_delete_impl`, `skills_export_symlink_impl`.
- [ ] Recursive copy helper using `walkdir` with 200MB cap.
- [ ] Symlink helpers gated on `cfg(unix)`; Windows returns structured
      error.
- [ ] Tests: copy + symlink against tmpdir; conflict detection.

Gate: `cargo test --lib skills::import`.

## Step 5 · `skills/commands.rs`

- [ ] Nine `#[tauri::command]` functions per design §7.
- [ ] All payloads `#[serde(rename_all = "camelCase")]`.

Gate: `cargo build` clean.

## Step 6 · Wire into Tauri

- [ ] `mod skills;` in `lib.rs`.
- [ ] In `lib_impl.rs`:
  - Add `skills` to the use-list at the top.
  - Register the nine commands in `tauri::generate_handler![]`.

Gate: `cargo build` clean.

## Step 7 · Extend `ClaudeProjectSkill`

- [ ] Add `source: Option<SkillSource>` and `is_symlink: bool` (with
      `#[serde(default)]`) to the struct.
- [ ] Update each list_* command to call `skills::source::classify`
      and `skills::source::is_symlink` for every returned skill.
- [ ] Update `src/types.ts` `ClaudeProjectSkill` to add the optional
      fields.
- [ ] No change to existing UI consumers — they ignore the new fields
      until SkillsHub uses them.

Gate: `cargo build`, `bunx tsc --noEmit` clean.

## Step 8 · Frontend service

- [ ] Create `src/services/skills.ts` with one wrapper per new command.
- [ ] Create `src/services/skills.test.ts` — mock `invoke`, verify
      each wrapper.

Gate: `bun test src/services/skills.test.ts` passes;
`bunx tsc --noEmit` clean.

## Step 9 · SkillsHub UI extension

- [ ] Edit `src/components/SkillsHub/SkillsHub.tsx`:
  - Add a `mode: 'registry' | 'external'` Segmented control above the
    existing search input.
  - When `mode === 'external'`: render the "Browse external" panel —
    list of detected paths + per-path skills + import buttons + add-
    path button.
  - When `mode === 'registry'`: existing skills.sh search behavior
    untouched.
  - Add a small `source` badge to the installed-skills row.

Gate: Manual click-through (only with explicit user permission to start
dev). `bunx tsc --noEmit` clean. No regression in existing
`AuthorPanel.test.tsx`.

## Step 10 · Final verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml skills`
- [ ] `bun test src/services/skills.test.ts`
- [ ] `bunx tsc --noEmit`
- [ ] `git status --short` — only in-scope paths.
- [ ] Confirm `mission_control.rs`, `trellis_*.rs`,
      `cc_workflow_studio*.rs` untouched.

Gate: all green.

## Step 11 · Spec entry

- [ ] Append a one-paragraph note to `.trellis/spec/tauri/index.md`
      under "Canonical Examples" pointing at `src-tauri/src/skills/`
      as the reference for "external path scanner + classifier-driven
      `source` field on existing skill outputs."

Gate: spec edit is one paragraph addition.

## Rollback points

- After Step 1: drop the new table; revert `wise_db.rs`.
- After Step 7: revert `claude_commands/project_skills.rs` struct
  fields and `src/types.ts` change.
- After Step 9: `git checkout -- src/components/SkillsHub/`.

## Notes for an external implementer

- Do **not** rewrite `skills_sh.rs`. It is left untouched; the new
  external scanner is a separate code path.
- Do **not** rewrite `ProjectSkillsPanel.tsx`. The `source` field flows
  in transparently.
- Plugin cache skills are `Builtin`. Don't allow `skills_delete` on them.
- Preserve all existing skills.sh registry search behavior.
- Symlink-on-Windows is a stub error in v1; do not invent
  workarounds.
