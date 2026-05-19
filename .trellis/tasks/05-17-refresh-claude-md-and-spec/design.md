# Design — Refresh CLAUDE.md and Trellis specs

## 1. Boundaries

- **In scope (write):** `CLAUDE.md`, `.trellis/spec/frontend/index.md`,
  `.trellis/spec/frontend/directory-structure.md`,
  `.trellis/spec/tauri/index.md`,
  `.trellis/spec/tauri/persistence-and-migrations.md`,
  `.trellis/spec/guides/index.md`.
- **In scope (read):** every directory listed in PRD R1/R2/R3, plus
  `AionUi-main/CLAUDE.md` and `AionUi-main/AGENTS.md` for structural
  comparison.
- **Out of scope:** any file under `src/`, `src-tauri/`, `scripts/`,
  `.trellis/scripts/`, `.trellis/workflow.md`, `package.json`, capabilities
  JSON, migrations.
- **Sub-agents:** none. Edits are mechanical and surgical; the main agent
  performs them directly.

## 2. Source-of-truth map

For each rewrite, the source of truth is the live filesystem at edit time:

| Spec section | Source of truth | Capture command |
|---|---|---|
| `CLAUDE.md` Frontend | `ls src/` | inline `ls`, no glob |
| `CLAUDE.md` Tauri Backend | `ls src-tauri/src/` + `ls src-tauri/src/<subdir>/` | inline `ls` |
| `CLAUDE.md` Storage | `ls ~/.wise/` | inline `ls` |
| `directory-structure.md` tree | `ls src/` | inline `ls` |
| `tauri/index.md` Canonical Examples | `ls src-tauri/src/` | inline `ls` |
| `persistence-and-migrations.md` migration range | `ls src-tauri/migrations/` | inline `ls` |
| `guides/index.md` table | `ls .trellis/spec/guides/` | inline `ls` |

The agent re-reads each source list right before its corresponding edit, to
avoid stale snapshots.

## 3. Edit strategy per file

### 3.1 `CLAUDE.md`

Strategy: targeted `Edit` calls, one section at a time. Do NOT `Write` the
file wholesale (it would risk stomping on the GitNexus managed block).

Sections, in order:

1. **Architecture / Frontend** — replace the bullet list under `### Frontend`.
   Group by category: window entries, app shell, feature directories, support
   directories. One line per entry.
2. **Architecture / Tauri Backend** — replace the bullet list under
   `### Tauri Backend`. Group by category: entry, app setup, persistence,
   path/fs, repository, mission/Trellis runtime, workflow studio, Claude
   subsystem, knowledge graph, integrations, mascot/push, CUA/skills,
   capabilities/config.
3. **Storage** — append `prd-runs/` and any other directory present under
   `~/.wise/` that is currently missing.
4. **New: Trellis Spec & Skills** — insert immediately after the existing
   "Coding Rules" section. A 3-row table linking to the three `index.md`
   files and a one-liner callout for `agent-harness-architecture.md`.

Markers to preserve verbatim:

- `<!-- gitnexus:start -->` … `<!-- gitnexus:end -->`

`Edit` boundaries are chosen so they don't include those markers.

### 3.2 `.trellis/spec/frontend/directory-structure.md`

Strategy: single `Edit` on the ASCII tree block (the fenced ` ```text ` code
block). Reproduce the actual top-level layout. Then a second `Edit` on the
"Module Organization" examples section to reference modules that exist today
(`src/services/prdSplit/`, `src/services/workflow/`,
`src/features/cc-wf-studio/`).

The "Naming Conventions" and "Import Boundaries" sections are accurate; do
not touch them.

### 3.3 `.trellis/spec/tauri/index.md`

Strategy: `Edit` only the "Canonical Examples" bullet list. Re-bullet by
domain. Each line points at one file or directory and a one-line purpose.

The "Cross-Layer Contract" and "Pre-Development Checklist" sections are
accurate; do not touch them.

### 3.4 `.trellis/spec/tauri/persistence-and-migrations.md`

Strategy: surgical `Edit` on the "Migrations" section to add a
"Current Range" line and reference `src-tauri/src/wise_db.rs` as the include
site. The Scenario block stays intact.

### 3.5 `.trellis/spec/guides/index.md`

Strategy: single `Edit` to verify the existing table rows and add the
"Quick Reference" callout near the top. Existing rows already cover all
six guides; if so, only the callout is added.

## 4. Verification plan

Documentation-only, so no `bun test`. Verification is mechanical:

1. After all edits, run:
   ```bash
   ls src/
   ls src-tauri/src/
   ls src-tauri/migrations/
   ls ~/.wise/
   ls .trellis/spec/guides/
   ```
   and grep each spec file for entries that no longer exist.
2. Confirm `<!-- gitnexus:start -->` and `<!-- gitnexus:end -->` markers in
   `CLAUDE.md` are still both present.
3. Confirm no file under `src/` or `src-tauri/` was modified
   (`git status --short` shows only docs/spec/task changes).
4. Confirm no file under `AionUi-main/` was modified.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Accidentally rewriting the GitNexus managed block | Use `Edit` with old_string fully outside the markers |
| Stale src listing after async filesystem activity | Re-`ls` immediately before each spec edit |
| Drifting copy from AionUi-main into wise voice (Arco, UnoCSS, Electron) | Never copy verbatim; rephrase in wise's stack vocabulary (Tauri 2, Bun, AntD, Vite) |
| Breaking cross-references in spec files | Verify with `grep -F .trellis/spec` after edits |
| Adding new top-level docs the user did not ask for | Only `CLAUDE.md` and existing spec files are written |

## 6. Compatibility / rollback

- Pure docs change. Rollback is `git checkout -- CLAUDE.md .trellis/spec/`.
- No runtime impact, no migration impact, no agent-harness behavior change.

## 7. Open questions

None. PRD answers are sufficient.
