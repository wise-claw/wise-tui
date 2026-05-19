# Design — MCP protocol unified abstraction

## 1. Boundaries

**In scope (write):**
- `src-tauri/src/mcp/mod.rs` (new)
- `src-tauri/src/mcp/protocol.rs` (new — trait + payload structs)
- `src-tauri/src/mcp/transport.rs` (new — shared `test_connection` impl)
- `src-tauri/src/mcp/service.rs` (new — registry of `Arc<dyn McpProtocol>`)
- `src-tauri/src/mcp/claude.rs` (new — first concrete implementation)
- `src-tauri/src/mcp/commands.rs` (new — Tauri commands)
- `src-tauri/migrations/<NNN>_mcp_server.sql` (new; numeric prefix
  picked at execution time)
- `src-tauri/src/wise_db.rs` (one new include + `MIGRATIONS` entry)
- `src-tauri/src/lib.rs` (`mod mcp;`)
- `src-tauri/src/lib_impl.rs` (use stmt + handler registration)
- `src-tauri/src/claude_commands/mcp.rs` (refactor to delegate to
  `mcp::claude::ClaudeMcpAgent`; preserve all existing public command
  names and JSON shapes)
- `src/services/mcp/index.ts` (new wrappers)
- `src/services/mcp/index.test.ts` (new)
- Existing MCP UI (under `src/components/ClaudeMcp/` and
  `ClaudeMcpConfigPanel.tsx`) — additive: surface `needsAuth` /
  `authMethod` from the test result; otherwise unchanged.

**Out of scope:**
- Codex / Gemini / custom-engine MCP implementations.
- Extension-contributed MCP servers (the extension system task lays
  the foundation; this task only declares the `source: Extension`
  shape).
- Capability-driven transport filtering inside an *active session's*
  prompt loop (AionUi `acp/session/McpConfig.ts:48` analog).
- OAuth login flow itself (we surface `needsAuth`; redirect handling is
  a follow-up).
- Any change to wise's existing Claude session runtime
  (`claudeStreamRuntime.ts` etc.).

## 2. Trait contract

```rust
#[async_trait::async_trait]
pub trait McpProtocol: Send + Sync {
    fn id(&self) -> &'static str;            // backend slug, e.g. "claude"
    fn supported_transports(&self) -> &'static [TransportKind];
    async fn list_servers(&self) -> Result<Vec<McpServer>, String>;
    async fn sync_servers(&self, servers: &[McpServer]) -> Vec<SyncResult>;
    async fn remove_server(&self, name: &str) -> Result<(), String>;
    async fn test_connection(&self, server: &McpServer) -> McpConnectionTestResult;
}
```

All payloads `#[serde(rename_all = "camelCase")]`.

`enum McpTransport`:
- `Stdio { command: String, args: Vec<String>, env: BTreeMap<String, String> }`
- `Sse { url: String, headers: BTreeMap<String, String> }`
- `Http { url: String, headers: BTreeMap<String, String> }`
- `StreamableHttp { url: String, headers: BTreeMap<String, String> }`

Tagged with `#[serde(tag = "type", rename_all = "snake_case")]` so the
JSON shape is `{ type: "stdio", command: "...", ... }`.

`struct McpConnectionTestResult`:
- `ok: bool`
- `tools: Option<Vec<McpToolSummary>>`
- `error: Option<String>`
- `needs_auth: bool`
- `auth_method: Option<AuthMethod>`        // Oauth | Basic
- `www_authenticate: Option<String>`

`enum McpSource`: `User | Builtin | Extension(String)`.

## 3. Shared transport-level testing (`mcp/transport.rs`)

A single async function `pub async fn test_transport(transport: &McpTransport, env_overrides: &[(String, String)]) -> McpConnectionTestResult` covers all four transports.

- **stdio** — spawn the CLI with `tokio::process::Command`,
  `stderr: piped`, `stdin: piped`. Send a synthetic `initialize`
  JSON-RPC request, read one response, classify exit codes / errors:
  - `ENOENT` → "command not found".
  - `EACCES` → permission hint.
  - timeout (5s default) → "did not respond in time".
- **http / streamable_http** — `reqwest` (already in deps) POST a
  synthetic `initialize` body. On `401 + WWW-Authenticate`, parse the
  challenge:
  - `Bearer` realm → `auth_method: Oauth`.
  - `Basic` realm → `auth_method: Basic`.
- **sse** — open the EventStream via `reqwest`'s streaming response.
  Read one frame, then close. Same OAuth detection logic on `401`.

Concurrency: every entry point goes through a per-backend
`tokio::sync::Mutex` so two test invocations on the same backend
serialize.

## 4. Claude implementation (`mcp/claude.rs`)

`ClaudeMcpAgent` reads/writes Claude's existing MCP config. The
existing `claude_commands/mcp.rs` already knows the on-disk layout.
Refactor strategy:

1. **Keep** the file format readers/writers in `claude_commands/mcp.rs`
   exactly as-is. Move zero code.
2. **Implement** `McpProtocol` for `ClaudeMcpAgent` by *delegating* to
   the existing public functions in `claude_commands/mcp.rs`. The
   trait impl is pure adapter code — no business logic.
3. `supported_transports()` returns `&[Stdio, Sse, Http,
   StreamableHttp]` after verifying via Claude config docs (research
   step at the top of implement.md — until verified, ship `&[Stdio]`
   only and document in PR).

This preserves the user's existing Claude MCP config files byte-for-byte.

## 5. Service registry (`mcp/service.rs`)

```rust
pub struct McpService {
    backends: HashMap<&'static str, Arc<dyn McpProtocol>>,
    service_lock: tokio::sync::Mutex<()>,
}
```

`with_service_lock` gates concurrent multi-backend ops. Single-backend
ops use the per-backend lock from `transport.rs`.

`McpService::new(claude: Arc<ClaudeMcpAgent>) -> Self` registers the
single Claude backend at construction time. Future agents register
themselves via `pub fn register(&mut self, agent: Arc<dyn McpProtocol>)`.

## 6. Persistence

New table `mcp_server`:

```sql
CREATE TABLE IF NOT EXISTS mcp_server (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    transport   TEXT NOT NULL,    -- JSON of McpTransport
    enabled     INTEGER NOT NULL DEFAULT 1,
    source      TEXT NOT NULL,    -- 'user' | 'builtin' | 'extension:<name>'
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(name, source)
);
```

Migration registered in `wise_db.rs` (next free numeric prefix; pick
at execution time — Codex took `023`, Task 4 may take `024`, this
task takes the next free).

**Compatibility migration**: on first launch, `mcp_server` is empty.
Read Claude's existing config (via the existing `claude_commands/mcp.rs`
readers) and synthesize one `mcp_server` row per Claude server with
`source: 'user'` and `id` = stable hash of `(source, name)`. Behind a
boolean flag `mcp_compat_migrated` stored in `wise.db` `app_settings`
to run only once.

## 7. Tauri command surface

| Command | Args | Returns |
|---|---|---|
| `mcp_list_servers` | — | `Vec<McpServer>` |
| `mcp_save_server` | `{ server }` | `McpServer` |
| `mcp_delete_server` | `{ id }` | `()` |
| `mcp_test_connection` | `{ server }` | `McpConnectionTestResult` |
| `mcp_sync_to_engines` | `{ serverIds, engineIds }` | `Vec<SyncResult>` |
| `mcp_remove_from_engines` | `{ serverName, engineIds }` | `Vec<SyncResult>` |
| `mcp_supported_transports` | `{ engineId }` | `Vec<TransportKind>` |

Existing `claude_commands/mcp.rs` Tauri command names stay as-is and
delegate internally to the new layer. The new commands above coexist;
v2 of the UI may migrate, but v1 of this task does **not** break any
existing call site.

## 8. Frontend service + UI

`src/services/mcp/index.ts` — one wrapper per new command. No reactive
subscription.

UI delta is bounded:
- The MCP test-result modal (wherever the existing
  `ClaudeMcpAddServerModal.tsx` shows the result) reads `needsAuth` /
  `authMethod` and shows a "Sign in required (oauth)" hint when set.
- No new top-level surface.

## 9. Tests

**Rust unit tests:**
- `transport::tests::stdio_happy` — spawn `/bin/echo`-equivalent
  fixture, assert `ok = true`.
- `transport::tests::stdio_enoent` — non-existent command, assert
  `error.contains("command not found")`.
- `transport::tests::http_oauth_challenge` — spin up a test server
  via `tiny_http` (new dev-dep) returning `401 +
  WWW-Authenticate: Bearer realm="…"`. Assert `needs_auth: true`,
  `auth_method: Oauth`.
- `claude::tests::trait_impl_round_trip` — mocked file layout under
  tmpdir; list → save → list → delete.
- Migration round-trip test (insert / list / delete).

**Frontend tests:**
- Service wrappers (mock `invoke`). One test per command.

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Behavior regression in existing Claude MCP flow | New trait *delegates* to existing functions; no logic moves. Manual smoke test at end. |
| Migration prefix collision with Task 4 | Survey-then-pick at execution time (same rule as Task 4). |
| `tiny_http` adds a heavy dev-dep | Use only as `dev-dependencies`; not shipped. |
| Stdio probe hangs on a misbehaving server | 5s `tokio::time::timeout` wrap. |
| OAuth detection false positives | Only triggers on `401 + WWW-Authenticate` header; benign 401s without the header surface as plain error. |
| Existing `claude_commands/mcp.rs` callers break | Public command names + JSON shapes preserved. Trait wrap is internal. |

## 11. Compatibility / rollback

- New tables and modules are additive. The Claude MCP UI continues to
  work unchanged through the existing command names.
- Rollback = revert files + drop `mcp_server` table.
- The compat migration flag prevents re-importing servers on rollback +
  forward.

## 12. Open decisions

- **Trait signatures use `Result<T, String>` for errors.** Match the
  rest of wise's Tauri command style.
- **Per-backend lock lives in `transport.rs`, not in the trait.** The
  trait is composable; the lock is an implementation detail of the
  shared `test_transport` helper.
- **Compat-migration flag** stored in `app_settings` (existing JSON KV)
  rather than a dedicated column.
