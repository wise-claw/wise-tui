# Design — Extension system skeleton

## 1. Boundaries

**In scope (write):**
- `src-tauri/src/extensions/mod.rs`
- `src-tauri/src/extensions/manifest.rs`
- `src-tauri/src/extensions/loader.rs`
- `src-tauri/src/extensions/registry.rs`
- `src-tauri/src/extensions/lifecycle.rs`
- `src-tauri/src/extensions/watcher.rs`
- `src-tauri/src/extensions/commands.rs`
- `src-tauri/src/extensions/state.rs`
- `src-tauri/src/lib.rs` (one new `mod extensions;`)
- `src-tauri/src/lib_impl.rs` (handler registration + `manage()`)
- `src/types/extension.ts`
- `src/services/extensions.ts`
- `src/services/extensions.test.ts`
- `examples/wise-extensions/hello-world/` tree

**Out of scope:**
- `wise_db.rs` (extensions use a JSON file, not SQLite)
- `claude_commands/`, `mission_control.rs`, `trellis_*.rs`
- Any renderer change beyond service wrappers
- Sandbox / permission enforcement
- Hub install flow
- Webview iframes / settings tabs UI
- Migration of skills task to consume extension contributes

## 2. Manifest data model

Single Rust struct hierarchy with `serde`:

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub engines: Engines,
    pub description: String,
    #[serde(default)] pub author: Option<String>,
    #[serde(default)] pub homepage: Option<String>,
    #[serde(default)] pub repository: Option<String>,
    #[serde(default)] pub icon: Option<String>,
    #[serde(default)] pub lifecycle: Lifecycle,
    #[serde(default)] pub permissions: Permissions,
    #[serde(default)] pub dependencies: BTreeMap<String, String>,
    #[serde(default)] pub contributes: Contributes,
}
```

`Contributes` v1 holds three vectors only: `skills`, `themes`, `settings_declarations`. Each item carries a relative path validated to live under the extension dir.

Validation entry point: `pub fn validate(&self, ext_dir: &Path) -> Result<(), ManifestError>`. It enforces:
- `name` matches `^[a-z0-9-]+$`, no reserved prefix.
- `version` parses as semver.
- Every `script` / `file` path resolves under `ext_dir` (canonicalize before compare).
- No duplicate IDs across contribute types.

`ManifestError` is an enum implementing `Display` so the renderer surface gets readable messages.

JSON Schema generation is deferred — extension authors get the schema via the example + this design doc until a `schemars`-driven publishing step lands.

## 3. Loader

Scan order:
1. `WISE_EXTENSIONS_PATH` (PATH-separated env var; used for dev).
2. `~/.wise/extensions/`.
3. App resources dir if present (unused in v1; keep slot).

For each scan dir, list direct subdirs; in each subdir read `wise-extension.json`. Parse with `serde_json` after stripping `// …` line comments via `strip_json_comments` re-implemented inline (8-line helper, no new dep).

**`$file:` indirection**: walk the parsed `serde_json::Value` recursively before deserializing into `ExtensionManifest`. When a string value matches `$file:<rel>`, read `<ext_dir>/<rel>` (path-traversal checked) and substitute its parsed JSON value at that position. Recurse on the substituted value once. This avoids a forward-looking schema; substitution is purely textual at the JSON layer.

Dedup by `name` across sources — first wins.

Return `Vec<LoadedExtension { dir: PathBuf, manifest: ExtensionManifest, manifest_path: PathBuf }>`.

## 4. Registry

`pub struct ExtensionRegistry` held in `tauri::State` via `Arc<RwLock<RegistryInner>>`.

`RegistryInner` fields:
- `loaded: Vec<LoadedExtension>`
- `enabled_state: HashMap<String, bool>`     // persisted
- `errors: HashMap<String, String>`           // last-known error per extension
- `last_activation: HashMap<String, ActivationOutcome>` // captured stdout/stderr

`initialize(&self) -> Result<(), String>`:
1. Load all extensions.
2. Filter by engine compatibility (compare `engines.wise` with `env!("CARGO_PKG_VERSION")` via the `semver` crate — adds the dep).
3. Validate dependencies → topological sort. Cycle detection: Kahn's algorithm, fail with `cycle detected: a → b → a`.
4. Read `~/.wise/extension-states.json` — JSON `{ extensions: { [name]: { enabled, lastVersion, installed } } }`.
5. For each enabled, validate manifest, run `onActivate` if present.
6. Replace `RegistryInner` contents under a single write lock.

`hot_reload(&self) -> Result<(), String>`: builds a fresh `RegistryInner` value, then atomically swaps it in under one write lock. The PRD's "atomic swap of the singleton instance" pattern is realized as a swap of the inner state, since `tauri::State` itself is fixed at app setup.

Public read methods: `list()`, `skills()`, `themes()`, `settings_declarations()`, `permissions(name)` — each takes a brief read lock.

Public mutators: `set_enabled(name, enabled)`, `reload()`. `set_enabled` only changes `enabled_state` and re-resolves contributes for that one extension; full `reload()` re-runs `initialize`.

State persistence: `~/.wise/extension-states.json` written via `wise_paths::ensure_wise_home` + `tempfile::PersistableFile`-style write+rename. Fall back to direct write if the rename fails. (The repo already has an atomic-write helper in `wise_paths.rs`; reuse it.)

## 5. Lifecycle runner

`pub async fn run_hook(ext: &LoadedExtension, kind: HookKind) -> ActivationOutcome` lives in `lifecycle.rs`.

Each hook is one of:
- `script: String` (relative path) — spawn `node <ext_dir>/<script>` with `tokio::process::Command`.
- `shell: { command, args, timeout? }` — spawn `command` with `args`. Resolved via `which` only for the bare command; fully-qualified paths used as-is.

Per-kind timeouts:
- `onInstall` 120s
- `onUninstall` 60s
- `onActivate` / `onDeactivate` 30s

Timeout strategy: `tokio::time::timeout` wrapping `child.wait_with_output()`. On timeout, `child.start_kill()`. Stdout + stderr are captured (not inherited) and kept on `ActivationOutcome`.

Path-traversal check: for `script` only — canonicalize `ext_dir.join(script)` and assert `starts_with(ext_dir)`. For `shell.command`, no such check (the manifest is trusted to declare its own command).

For v1, only `onActivate` is invoked by the registry. Other hooks have schema slots but no execution path yet (commented in code, called out in §10).

## 6. Watcher

`watcher.rs` owns one `notify::RecommendedWatcher` per scan dir. On every event, debounce 1s using a single `tokio::time::Instant` cell; after the cooldown expires call `registry.hot_reload()`.

The watcher runs on a dedicated `tokio::task::spawn_blocking` for the OS event pump, and forwards events to a `tokio::sync::mpsc` channel consumed by an async task on the main runtime.

Filter: only events whose path basename equals `wise-extension.json` *or* whose path is **inside** an extension directory (we treat any in-tree file change as a manifest-side reload because `$file:` indirection lets one manifest depend on neighbour files).

## 7. Tauri commands

`extensions/commands.rs`:

| Command | Args | Returns |
|---|---|---|
| `extensions_list` | — | `Vec<ExtensionListEntry>` |
| `extensions_get_skills` | — | `Vec<SkillContribution>` |
| `extensions_get_themes` | — | `Vec<ThemeContribution>` |
| `extensions_get_settings_declarations` | — | `Vec<SettingsDeclaration>` |
| `extensions_set_enabled` | `{ name, enabled }` | `()` |
| `extensions_get_permissions` | `{ name }` | `Permissions` |
| `extensions_reload` | — | `Vec<ExtensionListEntry>` |

All payloads `#[serde(rename_all = "camelCase")]`. `ExtensionListEntry` carries `name`, `version`, `enabled`, `description`, `error?`, `lastActivation?`.

Registered in `lib_impl.rs:147` via `tauri::generate_handler![]` insertion.

`app.manage(ExtensionRegistry::new())` happens in setup, plus an async setup task that calls `registry.initialize().await` and starts the watcher.

## 8. Frontend service

`src/types/extension.ts` — hand-mirror of the public payload structs (small enough that drift is manageable; cross-checked by `extensions.test.ts`).

`src/services/extensions.ts` — one function per command. No memoization. No reactive subscription in v1 (callers can poll `extensions_list` after `extensions_set_enabled` resolves).

## 9. Example extension

`examples/wise-extensions/hello-world/`:
- `wise-extension.json` — uses `$file:` indirection for skills.
- `contributes/skills.json` — references `./skill.md`.
- `contributes/skill.md` — markdown body.
- `contributes/theme.json` — minimal theme `{ "id": "hello-warm", "name": "Hello Warm", "tokens": { "--hello-accent": "#A3B59A" } }`.
- `lifecycle/on-activate.mjs` — single-line `console.log('hello-world activated');`.

The example is documented as the canonical reference for extension authors; it lives under the repo so tests can reference it via a relative path fixture.

## 10. Verification

Rust unit tests under `src-tauri/src/extensions/`:
- `manifest::tests` — valid passes; reserved-prefix rejected; out-of-bounds script path rejected; semver malformed rejected; duplicate contribute IDs rejected.
- `loader::tests` — two scan dirs containing the same name → first wins; `$file:` indirection resolves; comments stripped.
- `registry::tests` — Kahn's algorithm cycle detection (`a → b → a`); engine-compat filter drops out-of-range extensions.
- `lifecycle::tests` — script path traversal rejected (synthetic `../escape.mjs`); timeout enforced via a 0.1s timeout against a sleep-2 fixture (skipped on CI if `node` unavailable).

Frontend tests:
- `extensions.test.ts` — mock `invoke`, assert each wrapper hits the right command name with the right argument shape.

Acceptance criteria require an end-to-end test driving the example extension. v1 ships a Rust integration test in `src-tauri/tests/extensions_e2e.rs` that:
1. Sets `WISE_EXTENSIONS_PATH` to the example dir.
2. Constructs a `Registry` directly (not through Tauri).
3. Asserts `list()` returns hello-world.
4. Asserts `skills()` returns one entry.
5. Asserts the markdown body resolves on disk.

The Tauri command shape is exercised only through the unit tests of the wrapper module — full end-to-end through the IPC layer requires running `tauri::test`, which is heavier than the v1 budget allows.

## 11. Risk register

| Risk | Mitigation |
|---|---|
| Manifest accepting paths outside ext dir | `canonicalize` before comparison; reject when `starts_with` fails. |
| `$file:` cycle | Substitution recursion bounded to depth 2; deeper indirection rejected. |
| Hot-reload race during `set_enabled` | Both ops take the inner write lock; serialization is implicit. |
| Watcher firing during `initialize` | Debounce + one-write-at-a-time inner lock; the second call stalls behind the first. |
| `node` not on PATH for example hook | Lifecycle test uses `process::Command::new("node")` only when `which("node").is_ok()`; otherwise skipped with a `#[ignore]`-equivalent flag. |
| Missing `~/.wise/extensions/` dir | `loader.scan_dir` treats `NotFound` as empty list, not as error. |
| Two extensions both named `foo` | Loader dedupe documented; registry never sees the duplicate. |
| Frontend type drift | `extensions.test.ts` hits a fixture JSON the Rust side also writes in a build script — out of scope here, so document drift risk and rely on PR review. |

## 12. Compatibility

Pure additive. No existing table altered. No existing command renamed. Rollback = `git checkout -- src-tauri/src/extensions src-tauri/src/lib.rs src-tauri/src/lib_impl.rs src/services/extensions.* src/types/extension.ts examples/wise-extensions/`.

## 13. Open decisions (resolved)

- **Hook runner**: `tokio::process::Command` (not sidecar). Sidecars require declared binaries in `tauri.conf.json`; v1 trusts the manifest author to declare a runnable `command`.
- **Schema generation**: deferred; manifest authors copy from the example.
- **Dependency crate**: `semver = "1"` added to `Cargo.toml`.
- **State storage**: `~/.wise/extension-states.json` (atomic write+rename), not SQLite. Keeps task fully decoupled from `wise_db.rs`.
