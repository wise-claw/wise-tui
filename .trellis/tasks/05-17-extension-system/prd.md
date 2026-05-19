# Extension system skeleton

## Goal

Stand up a minimal but real extension system for wise: a manifest schema,
a registry that loads extensions from well-known directories, hot-reload on
file change, and a sidecar-based lifecycle hook runner. Ship at least one
example extension that contributes one of each supported type. This is the
foundation that the Skills, MCP, and Agent tasks will later plug into; it
does **not** depend on them.

## Background

AionUi (`AionUi-main/src/process/extensions/`) is the reference:

- `types.ts:504` — single Zod manifest schema declaring 11 contribute types.
- `ExtensionLoader.ts:31-50` — directory scanning + manifest parse + Zod
  validate + `$file:` indirection + env-var templating.
- `ExtensionRegistry.ts:64-181, 313-339, 430-458` — initialize, dependency
  topo-sort, parallel resolver fan-out, atomic hot-reload via instance swap.
- `lifecycle/lifecycle.ts:73-179` — fork-per-hook execution with timeout
  and SIGKILL.
- `sandbox/sandbox.ts:89-322` — Worker Thread sandbox + permission gating
  (out of scope for v1; see §Out of Scope).
- `examples/hello-world-extension/`, `examples/e2e-full-extension/` —
  real manifests with `$file:` indirection.

Tauri 2 adaptation gotchas (do not skip):

- No `worker_threads`. Sandbox = sidecar subprocess (later milestone) OR
  in-process trust-the-author for v1.
- No Electron `contextBridge`. Extension UI surfaces are Tauri webview
  `WebviewWindow` (out of scope for v1) — v1 ships data contributes only
  (skills, themes, settings declarations), no UI iframes.
- File-watching: `notify` crate or `tauri-plugin-fs` watcher.
- Asset URL: extensions reference assets via existing Tauri `asset://`
  scope. No new custom protocol.

## Requirements

### R1 — Manifest schema (`src-tauri/src/extensions/manifest.rs`)

- Rust struct with serde + JSON Schema generation (use `schemars` crate)
  so the same shape can be exposed to extension authors as
  `wise-extension.schema.json`.
- Required fields: `name` (regex `^[a-z0-9-]+$`, no reserved prefixes
  `wise-` / `internal-` / `builtin-` / `system-`), `version` (semver),
  `apiVersion`, `engines.wise` (semver range), `description`.
- Optional metadata: `author`, `homepage`, `repository`, `icon`,
  `i18n: { localesDir, defaultLocale }`.
- `lifecycle: { onInstall?, onActivate?, onDeactivate?, onUninstall? }` —
  each is `{ script } | { shell: { command, args, timeout? } }`. No path
  may resolve outside the extension directory (validated at load time).
- `permissions: { storage?, network?, shell?, filesystem?, clipboard? }`.
  v1 records permissions but does **not** enforce them at runtime.
- `dependencies: { extensionName: semverRange }`.
- `contributes` block for v1 includes only:
  - `skills[]: { name, description, file }` (markdown file relative path).
  - `themes[]: { id, name, file }` (CSS/JSON theme file relative path).
  - `settingsDeclarations[]` — pure-data settings keys an extension wants
    to register (renderer can show them with no extension code execution).
- A frontend mirror in `src/types/extension.ts` derived from the same
  schema (regenerate via build script or hand-mirror; choose in design).

### R2 — Loader

- Scan order:
  1. `WISE_EXTENSIONS_PATH` env var (PATH-separated, dev override).
  2. `~/.wise/extensions/` (user-installed).
  3. App resources directory (bundled, future).
- Each candidate dir contains one or more `<name>/wise-extension.json`.
- `$file:relative/path` indirection inside the manifest is resolved by
  reading and substituting the referenced JSON file.
- Manifest deduplicated by `name` across sources (first source wins).

### R3 — Registry (`src-tauri/src/extensions/registry.rs`)

- `pub struct ExtensionRegistry` held in `tauri::State`.
- `initialize()`:
  1. `loader.load_all()`.
  2. Engine-compatibility filter (drop extensions whose
     `engines.wise` doesn't satisfy current version).
  3. Dependency validation + topological sort.
  4. Load persisted state from `~/.wise/extension-states.json`
     (`enabled`, `installed`, `lastVersion`).
  5. For each enabled extension, run `onActivate` hook if present and
     resolve contributes.
- `hot_reload()`:
  - Build a new instance, run `initialize()` on it, swap into the
    `tauri::State` slot atomically.
- `get_skills()`, `get_themes()`, `get_settings_declarations()` — flat
  resolved lists with synthesized IDs `ext-<extensionName>-<contribId>`.

### R4 — Lifecycle runner (`src-tauri/src/extensions/lifecycle.rs`)

- Each hook executed as a sidecar subprocess via
  `tauri-plugin-shell` or `tokio::process::Command` (implementer chooses;
  document in design).
- Per-hook timeout: onInstall 120s, onUninstall 60s, others 30s.
- SIGKILL on timeout. Stdout/stderr captured and surfaced to the registry
  as part of the activation result.
- Path-traversal validation: `script` path must canonicalize to within
  the extension directory.

### R5 — File watcher

- `notify` recursive watch on each scanned directory, filtered to
  `wise-extension.json` changes.
- 1-second debounce.
- On change → `registry.hot_reload()`.

### R6 — Tauri command surface

- `extensions_list()` — loaded extensions with status (enabled, errors).
- `extensions_get_skills()`.
- `extensions_get_themes()`.
- `extensions_get_settings_declarations()`.
- `extensions_set_enabled(name, enabled)`.
- `extensions_get_permissions(name)`.
- `extensions_reload()` — manual hot-reload trigger.

### R7 — Example extension

- `examples/wise-extensions/hello-world/wise-extension.json` plus
  `contributes/skills.json`, `contributes/theme.json`,
  `contributes/skill.md`, `lifecycle/on-activate.mjs`.
- Demonstrates `$file:` indirection and a working `onActivate` hook that
  prints to stdout.
- Documented as the canonical reference for future extension authors.

### R8 — Tests

- Rust unit tests:
  - Manifest validation: valid passes, reserved-prefix rejected,
    out-of-bounds `script` path rejected.
  - Loader dedup: two dirs containing the same name → first wins.
  - Topo sort: dependency graph; cycle detected as error.
  - Hot-reload: edit → debounce → registry state contains new contribute.
- One end-to-end test driving the example extension through enable →
  contribute resolution → disable.

## Constraints

- Greenfield only. Do **not** modify Mission, Trellis, MCP, or Claude
  paths. Skills task will integrate later.
- Extension contributes are **data only** in v1. No JS/TS code from an
  extension is dynamically loaded into the renderer or main process at
  runtime. Lifecycle hooks run as detached subprocesses and exit; nothing
  long-lived.
- Permissions are recorded, not enforced (v1).
- Storage: extension *state* in a single JSON file
  `~/.wise/extension-states.json`. Per-extension data storage is **out of
  scope** (extension itself uses only filesystem under its own dir).
- No new custom URL scheme. Reuse existing Tauri `asset://`.
- English source.

## Acceptance Criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml extensions` passes.
- [ ] `bun test src/services/extensions` passes.
- [ ] Dropping `examples/wise-extensions/hello-world/` into
      `~/.wise/extensions/` and calling `extensions_list` returns it.
- [ ] Editing `wise-extension.json` while wise is running triggers a
      hot-reload (verified by `extensions_get_skills` reflecting the
      change without app restart).
- [ ] `onActivate` hook subprocess output is captured and exposed via
      `extensions_list` row metadata.
- [ ] Manifest with reserved prefix or out-of-bounds script path is
      rejected with a structured error string.
- [ ] No file outside `src-tauri/src/extensions/`, the new migration (if
      any), `wise_db.rs`, `lib_impl.rs`, `src/services/extensions/`,
      `src/types/extension.ts`, and `examples/wise-extensions/` is modified.

## Out of Scope

- Sandbox / permission enforcement (later milestone).
- Renderer extension UI surfaces (settings tabs, webui contributions).
- Hub / remote install / update.
- Extension-contributed MCP servers (the MCP task will add this *via*
  this skeleton in a follow-up).
- Extension-contributed assistants / agents (likewise).
- i18n loading from extension `localesDir` (manifest field exists; loader
  lands later).

## Notes

- Treat `AionUi-main/src/process/extensions/` as the reference for
  patterns and edge cases (especially `validateContributeIds`,
  reserved-prefix list, `$file:` indirection).
- Design and implement docs must be filled before `task.py start`.
