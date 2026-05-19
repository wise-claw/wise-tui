# Implement — Extension system skeleton

Top-to-bottom checklist. Each step lists pre-reads, the edit, and a gate.

## Step 0 · Re-baseline

- [ ] `ls src-tauri/src/` — confirm no `extensions/` dir yet.
- [ ] Read `src-tauri/src/wise_paths.rs` — find the atomic write helper.
- [ ] Read `src-tauri/Cargo.toml` deps — confirm `notify`, `serde`,
      `serde_json`, `tokio`, `dirs`, `regex`, `chrono` already present;
      record that `semver` is the only new dep.

Gate: choices logged.

## Step 1 · Add `semver` crate

- [ ] Edit `src-tauri/Cargo.toml` — add `semver = "1"` under `[dependencies]`.
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` once to populate
      the lockfile.

Gate: build succeeds.

## Step 2 · `manifest.rs`

- [ ] Create `src-tauri/src/extensions/mod.rs` exposing the submodules.
- [ ] Create `src-tauri/src/extensions/manifest.rs` per design §2.
- [ ] Tests: `mod tests` covering valid pass, reserved-prefix reject,
      malformed semver reject, out-of-dir script reject, duplicate
      contribute id reject.

Gate: `cargo test --manifest-path src-tauri/Cargo.toml extensions::manifest`.

## Step 3 · `loader.rs`

- [ ] Comment-stripper helper (8 lines).
- [ ] `$file:` resolver (depth-limited recursion).
- [ ] `scan_all(extra_dirs: &[PathBuf]) -> Vec<LoadedExtension>`.
- [ ] Tests: dedupe across two dirs; `$file:` indirection; missing scan
      dir treated as empty.

Gate: `cargo test … extensions::loader`.

## Step 4 · `state.rs`

- [ ] `ExtensionPersistedState` JSON shape + atomic load/save against
      `~/.wise/extension-states.json`.
- [ ] Tests: round-trip, missing file = empty.

Gate: `cargo test … extensions::state`.

## Step 5 · `registry.rs`

- [ ] `ExtensionRegistry` + `RegistryInner` per design §4.
- [ ] Topological sort (Kahn's algorithm); cycle detection.
- [ ] `initialize`, `hot_reload`, `set_enabled`, `list`, `skills`,
      `themes`, `settings_declarations`, `permissions(name)`.
- [ ] Tests: cycle detection, engine-compat filter, set_enabled flips.

Gate: `cargo test … extensions::registry`.

## Step 6 · `lifecycle.rs`

- [ ] `run_hook(ext, kind) -> ActivationOutcome`.
- [ ] Per-kind timeouts; SIGKILL on timeout.
- [ ] Path-traversal check on `script`.
- [ ] Tests: traversal rejection; timeout enforced (gated on
      `which::which("node").is_ok()` to keep CI hermetic).

Gate: `cargo test … extensions::lifecycle`.

## Step 7 · `watcher.rs`

- [ ] `notify::recommended_watcher` per scan dir + 1s debounce.
- [ ] Forwards into a tokio mpsc channel; consumer calls
      `registry.hot_reload().await`.
- [ ] Surfaced as `pub fn start(registry: Arc<…>) -> JoinHandle<()>`.

Gate: `cargo build` clean (watcher exercised manually in Step 11).

## Step 8 · `commands.rs`

- [ ] Seven `#[tauri::command]` functions per design §7.
- [ ] All payloads `#[serde(rename_all = "camelCase")]`.

Gate: `cargo build` clean.

## Step 9 · Wire into Tauri app

- [ ] Edit `src-tauri/src/lib.rs` — `mod extensions;`.
- [ ] Edit `src-tauri/src/lib_impl.rs`:
  - `app.manage(ExtensionRegistry::default())` in setup.
  - In an `async_runtime::spawn` block: `registry.initialize().await`
    then `extensions::watcher::start(registry.clone())`.
  - Add the seven commands to `tauri::generate_handler![]`.

Gate: `cargo build`.

## Step 10 · Frontend service + types

- [ ] Create `src/types/extension.ts` mirroring payload structs.
- [ ] Create `src/services/extensions.ts` — invoke wrappers.
- [ ] Create `src/services/extensions.test.ts` — `bun:test` + mocked
      `@tauri-apps/api/core` invoke. One test per command.

Gate: `bun test src/services/extensions.test.ts` and
`bunx tsc --noEmit` clean.

## Step 11 · Example extension

- [ ] Create `examples/wise-extensions/hello-world/wise-extension.json`
      with `$file:` indirection.
- [ ] `contributes/skills.json`, `contributes/skill.md`,
      `contributes/theme.json`, `lifecycle/on-activate.mjs`.

Gate: `WISE_EXTENSIONS_PATH=examples/wise-extensions cargo test
extensions_e2e` passes (the integration test added in Step 12).

## Step 12 · Integration test

- [ ] Create `src-tauri/tests/extensions_e2e.rs`:
  - Build a `Registry` directly with `extra_dirs` pointing at the
    example dir.
  - Assert `list()`, `skills()`, `themes()`.

Gate: `cargo test --manifest-path src-tauri/Cargo.toml --test extensions_e2e`.

## Step 13 · Final verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml extensions`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --test extensions_e2e`
- [ ] `bun test src/services/extensions.test.ts`
- [ ] `bunx tsc --noEmit`
- [ ] `git status --short` — only in-scope paths.
- [ ] Confirm `wise_db.rs`, `claude_commands/`, `mission_control.rs`,
      `trellis_*.rs` untouched.

Gate: all green.

## Step 14 · Spec entry

- [ ] Append a one-paragraph note to `.trellis/spec/tauri/index.md`
      pointing at `src-tauri/src/extensions/` as the reference for "JSON
      manifest + topo-sorted registry + hot-reload via inner-state swap."

Gate: spec edit is one paragraph addition.

## Rollback points

- After Step 1: `git checkout -- src-tauri/Cargo.toml src-tauri/Cargo.lock`.
- After Step 9: `git checkout -- src-tauri/src/lib.rs src-tauri/src/lib_impl.rs`
  + `rm -r src-tauri/src/extensions`.
- After Step 12: `rm -r examples/wise-extensions src-tauri/tests/extensions_e2e.rs`.

## Notes

- Do not import from `claude_commands/`, `mission_control.rs`,
  `trellis_*.rs`, or `wise_db.rs`.
- Sandbox / permission enforcement is out of scope per PRD; permissions
  are recorded only.
- Skills/MCP/Settings-tabs integration into `wise`'s real consumers
  belongs to follow-up tasks; this skeleton stops at exposing the data.
