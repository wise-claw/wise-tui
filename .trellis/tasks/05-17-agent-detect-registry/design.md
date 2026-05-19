# Design — Multi-Agent detection and registry

## 1. Boundaries

**In scope (write):**
- `src/types/detectedAgent.ts` (new)
- `src/types/detectedAgent.test.ts` (new)
- `src/services/agentRegistry.ts` (new)
- `src/services/agentRegistry.test.ts` (new)
- `src-tauri/src/agent_registry.rs` (new)
- `src-tauri/src/lib_impl.rs` (register commands + state)
- `src-tauri/src/wise_db.rs` (add migration include + entry in `MIGRATIONS`)
- `src-tauri/migrations/023_agent_custom.sql` (new)
- `src-tauri/capabilities/default.json` (add narrowest-possible shell perms)
- One existing settings page in `src/components/` to host the demo "Agents" section. Implementer picks the closest existing settings panel; do not create a new top-level tab.

**In scope (read for orientation):**
- `AionUi-main/src/common/types/detectedAgent.ts`
- `AionUi-main/src/process/agent/AgentRegistry.ts`
- `AionUi-main/src/process/agent/acp/AcpDetector.ts`
- `src-tauri/src/wise_db.rs` (migration registration pattern)
- `src-tauri/src/claude_commands/shared.rs` (probe patterns already in use)
- `src/services/claude.ts` (frontend invoke wrapper style)

**Out of scope:**
- Anything under `src-tauri/src/claude_commands/` other than read-for-pattern.
- `src-tauri/src/mission_control.rs`, `trellis_*.rs`, `cc_workflow_studio*.rs`.
- Renderer chat surfaces, Mission/Trellis UI.
- Workflow / cc-workflow-studio integration.

## 2. Type model (`src/types/detectedAgent.ts`)

```ts
/**
 * Detected agents are EXECUTION ENGINES (CLI binaries, future remote
 * endpoints). Assistants are CONFIGURATION that references an engine via
 * `presetAgentType`. Keep these two layers separate; do not collapse them.
 */
export type DetectedAgentKind = 'claude' | 'codex' | 'gemini' | 'custom';

type SharedFields = {
  id: string;             // synthesized: kind; custom: `custom:${rowId}`
  name: string;           // display label
  kind: DetectedAgentKind;
  available: boolean;
  backend: string;        // canonical backend slug (== kind for synthesized)
  binaryPath?: string;
  detectedAt: string;     // ISO-8601
  failureReason?: string; // populated when available === false
};

type KindFields = {
  claude: { command: 'claude' };
  codex: { command: 'codex' };
  gemini: { command: 'gemini' };
  custom: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
};

export type DetectedAgent<K extends DetectedAgentKind = DetectedAgentKind> =
  SharedFields & { kind: K } & KindFields[K];

export function isAgentKind<K extends DetectedAgentKind>(
  agent: DetectedAgent,
  kind: K,
): agent is DetectedAgent<K> {
  return agent.kind === kind;
}
```

Rust side mirrors this with `#[serde(tag = "kind", rename_all = "lowercase")]`
on an enum so the JSON shape matches the TS discriminated union exactly.

## 3. Rust registry (`agent_registry.rs`)

### 3.1 Module shape

```rust
pub struct AgentRegistry {
    state: RwLock<RegistryState>,
}

struct RegistryState {
    agents: Vec<DetectedAgent>,
    last_probed_at: Option<Instant>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DetectedAgent {
    Claude(SyntheticAgent),
    Codex(SyntheticAgent),
    Gemini(SyntheticAgent),
    Custom(CustomAgent),
}
```

Both variants serialize with `#[serde(rename_all = "camelCase")]` and flatten
the shared fields. The TS side stays a discriminated union via the `kind`
tag.

### 3.2 Detection

- **Synthesized builtin probes** — `tokio::process::Command::new("which")`
  on Unix, `"where"` on Windows; 2-second `timeout` via
  `tokio::time::timeout`. Probe failure = `available: false` plus
  `failureReason: "binary not found on PATH"` or the captured stderr.
- **Claude fallback path** — if `which claude` fails, also probe
  `~/.claude/local/claude` (this matches the existing logic in
  `claude_commands/shared.rs`; keep parity).
- **Custom agents** — `SELECT * FROM agent_custom ORDER BY created_at`.
  Each row is shaped to `DetectedAgent::Custom`. Probe is the same shell
  test against `command + args[0..0]` (just resolve the command), with
  user-supplied env merged into the probe environment.

### 3.3 Cache + refresh

- `last_probed_at` set after each full pass.
- `refresh_all(force: bool)` — short-circuits if `!force` and
  `Instant::now().duration_since(last) < 30s`.
- `refresh_builtin()` and `refresh_custom()` only update their slice of
  `agents`. Both still respect the cache window unless `force = true`.
- `RwLock<RegistryState>` is sufficient; probes themselves run outside the
  lock (build a new `Vec`, swap it in under a brief write lock).

### 3.4 Public Tauri commands

All in `lib_impl.rs` invoke handler:

| Command | Args | Returns |
|---|---|---|
| `agent_registry_list` | none | `Vec<DetectedAgent>` |
| `agent_registry_refresh` | `{ force: bool }` | `Vec<DetectedAgent>` |
| `agent_registry_get` | `{ id: String }` | `Option<DetectedAgent>` |
| `agent_registry_test_custom` | `CustomAgentInput` | `ProbeResult { ok, error?, resolvedPath? }` |
| `agent_registry_save_custom` | `CustomAgentInput` | `DetectedAgent` (the persisted row) |
| `agent_registry_delete_custom` | `{ id: String }` | `()` |

Errors flow through `Result<T, String>`; the frontend wrapper rethrows.

### 3.5 Persistence

Migration `023_agent_custom.sql`:

```sql
CREATE TABLE IF NOT EXISTS agent_custom (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    args_json   TEXT NOT NULL DEFAULT '[]',
    env_json    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
```

Registered in `wise_db.rs` `MIGRATIONS` list following the existing
`MIGRATION_NNN` const + `Migration { name, action: MigrationAction::Sql(...) }`
pattern.

## 4. Frontend integration

### 4.1 Service module

`src/services/agentRegistry.ts` — thin invoke wrappers, one function per
command. No memoization, no event subscription. Hook layer can add caching
later if needed.

### 4.2 UI host

The implementer surveys existing settings UI under `src/components/` and
hosts the new "Agents" section inside the most natural existing panel
(closest match: wherever Claude binary configuration currently lives). A
single component, two regions:

1. Detected list — read-only rows from `listAgents()`, manual refresh button.
2. Custom CRUD — Ant Design Form for `name / command / args / env` with a
   `Test` action that calls `testCustomAgent` and a `Save` that calls
   `saveCustomAgent`. Save is gated on a successful `Test`.

No reactive hook into the rest of the app. The registry is consulted on
demand; chat surfaces continue to use their existing Claude paths until a
follow-up task migrates them.

## 5. Capability scope

The shell binary execution must be granted explicitly. Add to
`src-tauri/capabilities/default.json` only the entries needed by the probe
strategy chosen above. Two acceptable shapes:

**Option A — `tauri-plugin-shell` allowlist** (preferred if other parts of
wise already use the plugin): add `shell:allow-execute` entries pinned to
`which`, `where`, and the candidate binaries (`claude`, `codex`, `gemini`).

**Option B — `tokio::process::Command` only**: no `tauri-plugin-shell`
permission needed (Tauri 2 does not gate `tokio::process` at the IPC layer
because it runs in the Rust process, not the renderer). Confirm against the
current capability file before relying on this — the plugin-shell side is
gated; pure Rust spawning is not.

Implementer picks A or B based on what's already in use. Document the
choice in implement.md step 6.

## 6. Verification

- `cargo test --manifest-path src-tauri/Cargo.toml agent_registry` covers:
  - Dedup with mixed inputs.
  - Cache hit (no probe call within 30s, observed via a probe-call counter
    injected into a `Probe` trait).
  - Cache bypass when `force = true`.
  - Custom agent insert → list → delete round trip against an in-memory
    SQLite (use `Connection::open_in_memory`).
- `bun test src/types/detectedAgent.test.ts` covers `isAgentKind` narrowing
  for every kind, including the negative case.
- `bun test src/services/agentRegistry.test.ts` mocks `@tauri-apps/api/core`
  and verifies each wrapper invokes the right command name with the right
  payload shape.
- Manual smoke (operator only, after the above pass):
  1. Launch dev build (only with explicit user permission).
  2. Open settings → Agents.
  3. Confirm Claude row reflects host state.
  4. Add a custom agent pointing at `/bin/echo`, see it persist across
     restart.

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Probe blocking event loop | Use `tokio::process::Command` + `tokio::time::timeout`. Never `std::process::Command::output()`. |
| `which` not on Windows | Branch on `cfg!(windows)` to use `where`. |
| Capability over-broadening | Pin shell perms to specific binaries; do not allow `*`. |
| Migration ordering collision | Use `023_` prefix; verify nothing else has claimed it. |
| Drift between Rust enum and TS union | Keep both files side-by-side in PR; reviewer treats them as one contract. |
| User schedules an agent before initial probe completes | `agent_registry_list` triggers a refresh if `state.agents` is empty; commands always return something usable. |
| Long-running probe hangs registry | Each probe wrapped in `timeout(2s)`; lock held only during `Vec` swap. |

## 8. Compatibility / rollback

- Pure additive change. No existing table altered. No existing command
  renamed. Rollback = revert files + drop `agent_custom` table (manual).
- `claude_commands/*` continue to work unchanged. The registry is consulted
  by new code paths only.

## 9. Open questions

None blocking. The implementer can decide:
- A or B for capability scope (see §5).
- Which existing settings panel hosts the "Agents" section (see §4.2).

Both are local decisions documented in implement.md before the first edit.
