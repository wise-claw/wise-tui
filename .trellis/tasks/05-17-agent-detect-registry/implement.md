# Implement — Multi-Agent detection and registry

<!-- Implementation notes:
- Step 0 settings host: `src/components/ClaudeConfigDirPanel/` because it already owns Claude Code local configuration inside the existing app settings modal.
- Step 6 capability choice: Option B. Probes run in Rust via `tokio::process::Command`, so renderer `tauri-plugin-shell` capability entries are not required.
-->

Top-to-bottom checklist. Each step lists pre-reads, the edit, and a gate.
Sub-agent dispatch (if used): every prompt starts with
`Active task: .trellis/tasks/05-17-agent-detect-registry`.

## Step 0 · Re-baseline

- [ ] `ls src-tauri/migrations/` — confirm `023_*` is free.
- [ ] `ls src/components/` and `ls src/components/Settings*/` — pick the
      existing settings panel that will host the demo Agents section.
      Record the choice at the top of this file as a comment.
- [ ] Read `src-tauri/src/wise_db.rs` lines 1–80 — confirm the
      `MIGRATION_NNN` const + `Migration { name, action }` pattern.
- [ ] Read `src-tauri/src/claude_commands/shared.rs` — note the existing
      `which claude` / `~/.claude/local/claude` fallback so the registry
      stays consistent with it.
- [ ] Read `AionUi-main/src/common/types/detectedAgent.ts` and
      `AionUi-main/src/process/agent/AgentRegistry.ts:40-300` for the
      pattern (do not copy; rephrase for Tauri).

Gate: choices logged, no edits yet.

## Step 1 · Type model

- [ ] Create `src/types/detectedAgent.ts` per design.md §2.
- [ ] Create `src/types/detectedAgent.test.ts` covering `isAgentKind`
      narrowing for all four kinds plus a negative case.

Gate: `bunx tsc --noEmit` clean for these two files;
`bun test src/types/detectedAgent.test.ts` passes.

## Step 2 · Migration

- [ ] Create `src-tauri/migrations/023_agent_custom.sql` per design.md §3.5.
- [ ] In `src-tauri/src/wise_db.rs`:
  - Add `const MIGRATION_023: &str = include_str!("../migrations/023_agent_custom.sql");`
    in the consts block.
  - Add `Migration { name: "023_agent_custom", action: MigrationAction::Sql(MIGRATION_023) }`
    to the `MIGRATIONS` list, preserving order.

Gate: `cargo build --manifest-path src-tauri/Cargo.toml` compiles.

## Step 3 · Rust registry module

- [ ] Create `src-tauri/src/agent_registry.rs` with:
  - `pub enum DetectedAgent` (serde-tagged on `kind`).
  - `CustomAgentInput`, `ProbeResult` payload structs.
  - `pub struct AgentRegistry { state: RwLock<RegistryState> }`.
  - `pub trait Probe` + default `OsProbe` impl using
    `tokio::process::Command` + `tokio::time::timeout`. The trait exists
    so tests can inject a `MockProbe` with a call counter.
  - `pub async fn refresh_all(&self, force: bool, probe: &dyn Probe)`,
    `refresh_builtin`, `refresh_custom`.
  - DB helpers `load_custom_agents`, `insert_custom_agent`,
    `delete_custom_agent` taking a `&Mutex<Connection>` from
    `wise_db`'s shared state.
- [ ] In `lib_impl.rs`:
  - `app.manage(AgentRegistry::new())` during setup.
  - Register all six Tauri commands. Match the camelCase serde shape.

Gate: `cargo build` succeeds. The new module isn't called from the renderer
yet, but compiles standalone.

## Step 4 · Rust tests

- [ ] In `agent_registry.rs` (or a sibling `agent_registry/tests.rs` if it
      grows), add tests covering:
  - Dedup of synthesized + custom inputs.
  - Cache: with `force=false` and a `MockProbe` whose call counter starts
    at 0, two consecutive `refresh_all` calls within 30s leave the counter
    at exactly the first-pass count (one probe set per agent).
  - Cache bypass: same setup but `force=true` doubles the counter.
  - Probe failure: `MockProbe` returns `Err` → agent is `available: false`
    with `failureReason` populated.
  - Custom agent CRUD against `Connection::open_in_memory()`.

Gate: `cargo test --manifest-path src-tauri/Cargo.toml agent_registry`
passes.

## Step 5 · Frontend service

- [ ] Create `src/services/agentRegistry.ts` — one function per Tauri
      command, returning the typed payload from `src/types/detectedAgent.ts`.
- [ ] Create `src/services/agentRegistry.test.ts` mocking
      `@tauri-apps/api/core`'s `invoke`; verify each wrapper hits the right
      command name with the right argument shape.

Gate: `bun test src/services/agentRegistry.test.ts` passes;
`bunx tsc --noEmit` clean.

## Step 6 · Capability scope

- [ ] Decide A or B per design.md §5 and document the choice at the top of
      this file.
- [ ] If A: add narrow `shell:allow-execute` entries to
      `src-tauri/capabilities/default.json` for `which` / `where` /
      `claude` / `codex` / `gemini`.
- [ ] If B: leave the file untouched and add a one-line comment in
      `agent_registry.rs` explaining that probes use `tokio::process` and
      therefore bypass the plugin-shell capability gate.

Gate: `cargo build` still clean; no broadened wildcards in the capabilities
file.

## Step 7 · Demo UI surface

- [ ] In the settings panel chosen at Step 0, add an `<AgentRegistrySection />`
      component:
  - Calls `listAgents()` on mount and on the Refresh button.
  - Renders rows with name, kind badge, available indicator, binary path,
    failure reason on hover when `available=false`.
  - Custom CRUD modal: Ant Design Form with fields per `CustomAgentInput`,
    Test button calling `testCustomAgent`, Save gated on a passing test.
- [ ] No changes to chat or Mission/Trellis surfaces.

Gate: `bunx tsc --noEmit` clean. Manual click-through (only with explicit
user permission to start dev): list reflects host, custom add/delete persists
across restart.

## Step 8 · Verification

- [ ] `bun test src/types/detectedAgent.test.ts src/services/agentRegistry.test.ts`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml agent_registry`
- [ ] `bunx tsc --noEmit`
- [ ] `git status --short` — confirm only the in-scope files changed.
- [ ] `grep -RIn 'localStorage' src/services/agentRegistry.ts src/types/detectedAgent.ts`
      → empty.
- [ ] `grep -n 'std::process::Command' src-tauri/src/agent_registry.rs`
      → empty (must be `tokio::process::Command`).

Gate: all green. Mark task complete.

## Step 9 · Spec update

- [ ] Append a one-paragraph note to `.trellis/spec/tauri/index.md`
      "Canonical Examples" pointing at `agent_registry.rs` as a reference
      for "process-wide singleton state via `tauri::State` + cached probes."
- [ ] No other spec edits.

Gate: spec edit is additive, not a rewrite.

## Rollback points

- After Step 2: drop `agent_custom` table manually + revert
  `wise_db.rs` change.
- After Step 7: delete the new files in scope and the
  `<AgentRegistrySection />` mount point.

## Notes for an external implementer (e.g., Codex)

- The four module boundaries are deliberately tight: types → migration →
  Rust registry → frontend service → demo UI. Implement in that order;
  each step gates compile/tests before the next.
- Do not import anything from `claude_commands/` into `agent_registry.rs`.
  Read it for pattern parity (the Claude binary fallback path), then
  re-implement locally.
- Do not touch `mission_control.rs`, `trellis_*.rs`, or
  `cc_workflow_studio*.rs`.
- Keep the Rust enum + TS union in lock-step. If you change one shape,
  change the other in the same commit.
