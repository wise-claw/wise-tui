# MCP protocol unified abstraction

## Goal

Refactor wise's MCP handling so every supported AI engine (Claude today,
Codex/Gemini/custom in the future) talks to MCP servers through a single
trait-based protocol, not through engine-specific call sites. Cover all four
official transports (`stdio | sse | http | streamable_http`), unified
connection-test semantics (including OAuth detection), and capability-driven
transport filtering. The existing Claude MCP path becomes the first concrete
implementation of this protocol; no new engines are added by this task.

## Background

AionUi (`AionUi-main/src/process/services/mcpServices/`) treats MCP as a
backend-neutral protocol:

- `McpProtocol.ts:64-105` — `IMcpProtocol` interface every backend
  implements.
- `McpProtocol.ts:110-531` — `AbstractMcpAgent` shared base: per-backend
  `withLock` queue, env-injection hooks, transport-switched
  `testMcpConnection`, HTTP probe-first that surfaces `WWW-Authenticate`
  for OAuth.
- `agents/{Claude,Gemini,Codex,…}McpAgent.ts` — concrete subclasses, one per
  CLI backend.
- `McpService.ts:27-376` — process-wide singleton; `agents: Map<McpSource,
  IMcpProtocol>` keyed by backend; `withServiceLock` gates concurrent
  cross-backend ops.
- `acp/session/McpConfig.ts:48-85` — capability-driven filter: for a given
  session, drop transports the agent's `mcpCapabilities` doesn't claim to
  support.

wise current state:

- `src-tauri/src/claude_commands/mcp.rs` is the only MCP surface and is
  hard-bound to Claude's config layout.
- There is no notion of "transport-level connection test" — connection
  failures surface as opaque errors with no OAuth hint.
- There is no central place to ask "does engine X support http
  streamable?" — every call site assumes stdio.
- `~/.wise/wise.db` does not store user MCP servers as a normalized
  resource; they live inside per-engine config files.

## Requirements

### R1 — MCP protocol trait (`src-tauri/src/mcp/protocol.rs`)

- New module exporting:
  - `enum McpTransport { Stdio { command, args, env }, Sse { url, headers },
    Http { url, headers }, StreamableHttp { url, headers } }`.
  - `struct McpServer { id, name, transport, enabled, source: McpSource }`.
  - `enum McpSource { User, Builtin, Extension(String) }`.
  - `struct McpConnectionTestResult { ok, tools?, error?, needs_auth?,
    auth_method?: 'oauth' | 'basic', www_authenticate? }`.
  - `#[async_trait] pub trait McpProtocol`:
    - `fn id() -> &'static str` — backend slug.
    - `async fn list_servers() -> Vec<McpServer>` — engine-side current
      servers.
    - `async fn sync_servers(servers: &[McpServer]) -> Vec<SyncResult>`.
    - `async fn remove_server(name: &str) -> Result<(), String>`.
    - `async fn test_connection(server: &McpServer) -> McpConnectionTestResult`.
    - `fn supported_transports() -> &'static [TransportKind]`.
- All payload types `#[serde(rename_all = "camelCase")]`.

### R2 — Shared transport-test logic

- Provide a generic helper module that delegates the engine-agnostic parts:
  - Per-backend operation lock (`tokio::sync::Mutex`) so concurrent
    sync/remove ops on the same backend serialize.
  - Default `test_connection` impl that switches on transport:
    - **stdio** — spawn the CLI with `tokio::process::Command`,
      `stderr: piped`, send `initialize` JSON-RPC, classify errors
      (ENOENT → "command not found"; EACCES → permission; timeout →
      network/start).
    - **http / streamable_http** — probe with a synthetic `initialize`
      POST; on `401 + WWW-Authenticate` return `needs_auth: true` with
      `auth_method` parsed from the header.
    - **sse** — open the EventStream, fail-fast on first error; same OAuth
      detection.
  - Env-injection hook (resolve `~`, expand env vars in `transport.env`).

### R3 — Claude implementation (`src-tauri/src/mcp/claude.rs`)

- Concrete `ClaudeMcpAgent` implementing `McpProtocol`.
- Reads/writes Claude's existing MCP config (whatever files
  `claude_commands/mcp.rs` currently touches) so behavior is unchanged
  from the user's perspective.
- `supported_transports` returns the set Claude actually supports today
  (research during design phase; do not assume).
- Existing call sites in `claude_commands/mcp.rs` are migrated to delegate
  to this implementation. No public Tauri command names change.

### R4 — Service registry (`src-tauri/src/mcp/service.rs`)

- `McpService` singleton holding `HashMap<&'static str, Arc<dyn McpProtocol>>`.
- `with_service_lock` gates concurrent multi-backend ops.
- Accepts `agents` parameter on every multi-backend call (so callers
  decide which engines to sync to, mirroring AionUi's API).

### R5 — Persistence

- New table `mcp_server` storing user servers as the source of truth:
  ```
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  transport    TEXT NOT NULL,    -- JSON of McpTransport
  enabled      INTEGER NOT NULL DEFAULT 1,
  source       TEXT NOT NULL,    -- 'user' | 'builtin' | 'extension:<name>'
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(name, source)
  ```
- Migration registered in `wise_db.rs` (next free numeric prefix).

### R6 — Tauri command surface

Public commands (camelCase serde):

- `mcp_list_servers()` — full list with source.
- `mcp_save_server(server)`.
- `mcp_delete_server(id)`.
- `mcp_test_connection(server)` — returns `McpConnectionTestResult`.
- `mcp_sync_to_engines(serverIds, engineIds)`.
- `mcp_remove_from_engines(serverName, engineIds)`.
- `mcp_supported_transports(engineId)` — for capability-driven UI.

Existing command names from `claude_commands/mcp.rs` either stay (delegated
to the new layer) or are deprecated with a one-version overlap. Implementer
documents the choice in design.md.

### R7 — Frontend service + UI smoke

- `src/services/mcp/index.ts` thin invoke wrappers around the new commands.
- Update the existing MCP management UI to use the new service module.
  Visual changes minimal — the one user-visible improvement is OAuth-
  required detection surfacing a "Sign in" hint in the test result.

### R8 — Tests

- Rust unit tests covering each transport's `test_connection` happy and
  failure paths (stdio: spawn `/bin/echo`-style fixture; http: hit a
  mock server returning 401 + `WWW-Authenticate`).
- Frontend tests for the service wrappers (mock `invoke`).
- Migration round-trip test (insert / list / delete).

## Constraints

- Existing user MCP configs must keep working. Either auto-migrate from
  Claude's config file into `mcp_server` table on first launch, or read
  both and de-dupe. Implementer chooses; document in design.md.
- No engine other than Claude is implemented in this task. The trait must
  not have Claude-specific assumptions baked in.
- No `localStorage` for MCP state.
- Shell capabilities stay narrow.
- English source; comments only when non-obvious per project policy.
- This task is **independent** of the agent registry task; the two share
  no types except possibly `engineId` strings, which are agreed upon by
  convention not by import.

## Acceptance Criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml mcp` passes (unit
      tests for each transport + migration round-trip).
- [ ] `bun test src/services/mcp` passes.
- [ ] `bunx tsc --noEmit` clean.
- [ ] Existing Claude MCP user flow (add server, test, sync) works
      end-to-end with no user-visible regression.
- [ ] Adding a server with an `http` transport that requires OAuth surfaces
      `needsAuth: true` and `authMethod` from the test result.
- [ ] `mcp_supported_transports('claude')` returns the actual Claude-
      supported set (verified against the implementation, not hard-coded).
- [ ] No file outside `src-tauri/src/mcp/`, `src-tauri/migrations/NNN_…`,
      `src-tauri/src/wise_db.rs`, `src-tauri/src/claude_commands/mcp.rs`,
      `src-tauri/src/lib_impl.rs`, and `src/services/mcp/` is modified
      (plus the existing MCP management UI files when migrating).

## Out of Scope

- Codex / Gemini / custom-agent MCP implementations.
- Extension-contributed MCP servers (handled by the extension task).
- Capability-driven transport filtering inside an *active session*'s
  prompt loop (AionUi `acp/session/McpConfig.ts:48` analog) — emits the
  capability data; consumption belongs to a follow-up.
- OAuth login flow itself (we surface `needsAuth`; the actual login
  redirect is a follow-up).

## Notes

- Design and implement files must be filled in before `task.py start`.
- AionUi reference points at patterns; do not copy the TypeScript verbatim
  into Rust/TS — re-derive for Tauri's stack.
