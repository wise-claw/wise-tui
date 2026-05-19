# Implement — MCP protocol unified abstraction

Top-to-bottom checklist. Run **after** Codex's Task 1 has merged so
`lib_impl.rs` and `wise_db.rs` are stable.

## Step 0 · Re-baseline

- [ ] `ls src-tauri/migrations/` — record highest numeric prefix.
- [ ] `git log -- src-tauri/src/lib_impl.rs src-tauri/src/wise_db.rs`
      — confirm Codex's `agent_registry` changes have landed.
- [ ] Read `src-tauri/src/claude_commands/mcp.rs` end-to-end —
      enumerate every public function and Tauri command name; record
      the on-disk file layout it touches.
- [ ] Web-search: confirm which MCP transports Claude Desktop / Claude
      Code support today. Record findings in
      `claude::supported_transports()`. If unverifiable, ship
      `&[Stdio]` only and call out in PR description.

Gate: prefix recorded; transport set decided.

## Step 1 · Protocol module

- [ ] Create `src-tauri/src/mcp/mod.rs` re-exporting submodules.
- [ ] Create `src-tauri/src/mcp/protocol.rs` per design §2.
- [ ] Add `async-trait = "0.1"` to `Cargo.toml` (already used elsewhere
      in deps? `git grep async-trait src-tauri/Cargo.toml` first).
- [ ] Compile; no tests yet.

Gate: `cargo build` clean.

## Step 2 · Shared transport tester

- [ ] Create `src-tauri/src/mcp/transport.rs` per design §3.
- [ ] Tests: stdio happy + ENOENT; http oauth challenge using
      `tiny_http` (dev-dep). Add `tiny_http = "0.12"` to
      `[dev-dependencies]`.

Gate: `cargo test --lib mcp::transport`.

## Step 3 · Migration

- [ ] Create `src-tauri/migrations/<NNN>_mcp_server.sql`.
- [ ] Add include + `MIGRATIONS` entry in `wise_db.rs`.
- [ ] Add the migration round-trip test under
      `src-tauri/tests/mcp_migration.rs`.

Gate: `cargo test --test mcp_migration`.

## Step 4 · Claude trait impl

- [ ] Create `src-tauri/src/mcp/claude.rs`. `ClaudeMcpAgent` holds an
      `Arc<MutexConnection>` (the existing wise db Mutex) and delegates
      every method to the existing public functions in
      `claude_commands/mcp.rs`.
- [ ] Tests: a mock fs layout exercises list → save → list → delete.

Gate: `cargo test --lib mcp::claude`.

## Step 5 · Service registry

- [ ] Create `src-tauri/src/mcp/service.rs` per design §5.
- [ ] No new tests at this level — exercised by command tests and the
      manual smoke at the end.

Gate: `cargo build` clean.

## Step 6 · Tauri commands

- [ ] Create `src-tauri/src/mcp/commands.rs` with the seven commands
      from design §7.
- [ ] All payloads `#[serde(rename_all = "camelCase")]`.

Gate: `cargo build` clean.

## Step 7 · Wire into Tauri

- [ ] `mod mcp;` in `lib.rs`.
- [ ] In `lib_impl.rs`:
  - Add `mcp` to the use-list.
  - Construct `McpService::new(Arc::new(ClaudeMcpAgent::new(db)))` in
    setup; `app.manage(service)`.
  - Register the seven commands.

Gate: `cargo build` clean.

## Step 8 · Compatibility migration

- [ ] On first run, read Claude's existing MCP config and synthesize
      `mcp_server` rows. Set `app_settings['mcp_compat_migrated'] = true`.
- [ ] Tests: idempotent on re-run.

Gate: `cargo test --lib mcp::service::tests::compat_migration_is_idempotent`.

## Step 9 · Frontend service + UI

- [ ] Create `src/services/mcp/index.ts` and
      `src/services/mcp/index.test.ts`.
- [ ] In the existing MCP UI (test-result modal), surface `needsAuth` /
      `authMethod` as a "Sign in required" hint.
- [ ] No top-level surface changes.

Gate: `bun test src/services/mcp` passes; `bunx tsc --noEmit` clean.

## Step 10 · Final verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml mcp`
- [ ] `cargo test --test mcp_migration`
- [ ] `bun test src/services/mcp`
- [ ] `bunx tsc --noEmit`
- [ ] `git status --short` — only in-scope paths.
- [ ] Manual smoke (only with explicit user permission to start dev):
      add a Claude MCP server, test connection, sync to Claude — all
      existing behavior preserved; OAuth-required server surfaces the
      "Sign in" hint.

Gate: all green.

## Step 11 · Spec entry

- [ ] Append a one-paragraph note to `.trellis/spec/tauri/index.md`
      pointing at `src-tauri/src/mcp/` as the reference for "trait-based
      protocol with shared transport-level connection testing across
      stdio/sse/http/streamable_http and OAuth challenge surfacing."

Gate: spec edit is one paragraph addition.

## Rollback points

- After Step 3: drop `mcp_server` table; revert `wise_db.rs`.
- After Step 7: revert `lib.rs` + `lib_impl.rs` use stmts and
  registrations; delete `mcp/` module.
- After Step 8: clear the `mcp_compat_migrated` flag in `app_settings`.

## Notes for an external implementer

- Do **not** move code out of `claude_commands/mcp.rs`. The trait wrap
  is pure adapter code.
- Do **not** introduce new MCP backends in this task. Codex / Gemini /
  custom agents land in follow-up tasks.
- Capability-driven session-time filtering (AionUi `McpConfig.ts:48`
  analog) is out of scope.
- OAuth login redirect is out of scope. Only the hint surfaces.
- Treat the Claude config file format as untouched ground truth.
