# Multi-Agent detection and registry

## Goal

Introduce a typed `DetectedAgent` discriminated union and a process-wide
`AgentRegistry` that detects available CLI/local AI execution engines on the
host (Claude Code, Codex, Gemini, plus user-defined custom CLIs) and exposes
the merged list to the renderer via a typed Tauri command surface. This
unifies how wise reasons about "which AI engines are available right now,"
replacing the current Claude-only assumption baked into `claude_commands/`.

This task is **execution-engine-only**. It does not change Mission, Trellis,
prompts, or how an active conversation talks to its engine. It produces the
catalog and the swap UI; it does not rewire workflow execution.

## Background

AionUi (reference at repo root, `AionUi-main/`) treats execution engines as a
first-class abstraction:

- `src/common/types/detectedAgent.ts:27-103` — `DetectedAgent<K>` discriminated
  union over `kind: 'gemini' | 'acp' | 'remote' | …` plus `isAgentKind<K>`
  type guard. Comment block at the top is the conceptual core: assistants are
  configuration that *references* an engine; detected agents are the engines.
- `src/process/agent/AgentRegistry.ts:40-300` — singleton; merges five sources
  (synthesized always-on, builtin CLI probe, extension-contributed,
  user-custom, remote) with priority + `runExclusiveMutation` Promise-chain
  mutex; granular `refresh*` methods so PATH/install events don't trigger a
  full re-probe.
- `src/process/agent/acp/AcpDetector.ts:153-255` — three detection sources
  (builtin via `which`/`where`, extension-declared via manifest, user-custom
  via storage). Builtins probed against `POTENTIAL_ACP_CLIS` list.
- `src/renderer/components/agent/AgentSetupCard.tsx` — hot-swap card mounted
  above the chat input when readiness fails.
- `src/renderer/components/agent/AgentBadge.tsx`, `AgentModeSelector.tsx`,
  `AcpModelSelector.tsx` — per-conversation indicator + selectors.

wise's current state:

- `src-tauri/src/claude_commands/` is the only execution-engine surface, and
  it is hard-bound to Claude.
- `src/services/claude.ts` and siblings (`claudeStreamRuntime.ts`,
  `claudeSpawnSlots.ts`, `claudeConfigDir.ts`, `claudeCodeUsage.ts`) reach
  for Claude-specific paths and binaries directly.
- There is no central place to ask "is Codex installed?" or "is Gemini CLI
  on PATH?" — UI surfaces that need to know currently shell out per-call.
- Users cannot register a custom CLI agent (e.g., a local LLM CLI) without
  source edits.

## Requirements

### R1 — Type model (frontend, `src/types/detectedAgent.ts`)

- New module that exports:
  - `DetectedAgentKind` string-literal union: `'claude' | 'codex' | 'gemini'
    | 'custom'` (initial set; `'remote'` is **out of scope** for this task).
  - `DetectedAgent<K extends DetectedAgentKind = DetectedAgentKind>` type
    with shared fields `{ id; name; kind; available; backend; binaryPath?;
    detectedAt: string; failureReason?: string }` plus per-kind narrowed
    fields via a `KindFields[K]` mapping.
  - `isAgentKind<K>(agent, kind): agent is DetectedAgent<K>` type guard.
- The frontmatter doc-comment must explicitly distinguish detected agent
  (engine) from assistant (configuration).
- No runtime code in this module. Pure types + the type guard.

### R2 — Rust registry (`src-tauri/src/agent_registry.rs`)

- `AgentRegistry` struct held in `tauri::State` — process-wide singleton, not
  a `static` global.
- Detection sources for v1:
  - `claude` (always synthesized; `available` driven by `which claude` /
    fallback to `~/.claude/local/claude`).
  - `codex` (synthesized; `which codex`).
  - `gemini` (synthesized; `which gemini`).
  - `custom` agents read from a SQLite table `agent_custom` (see R5).
- A merge step deduplicates by `backend` (synthesized) and by `id`
  (custom/future-remote), preserving insertion order.
- A `RwLock<RegistryState>` with `refresh_*` methods (`refresh_builtin`,
  `refresh_custom`, `refresh_all`) — each acquires a write lock and updates
  in-place. No async-mutex unless a probe is async.
- Probes use `tokio::process::Command` with **2-second per-probe timeout**.
  A probe failure marks the agent `available: false` with `failureReason`
  populated; it does **not** remove it.
- Probe results cached for 30 seconds. `refresh_all(force: true)` bypasses
  cache; the default Tauri command path passes `force: false`.

### R3 — Tauri command surface

Add to `lib_impl.rs` invoke handler:

- `agent_registry_list() -> Vec<DetectedAgent>` — current snapshot.
- `agent_registry_refresh(force: bool) -> Vec<DetectedAgent>`
- `agent_registry_get(id: String) -> Option<DetectedAgent>`
- `agent_registry_test_custom(input: CustomAgentInput) -> ProbeResult` —
  probe a custom CLI definition without persisting it.
- `agent_registry_save_custom(input: CustomAgentInput) -> DetectedAgent` —
  persist + refresh.
- `agent_registry_delete_custom(id: String) -> ()`.

Each command returns `serde_json`-friendly types matching R1 verbatim. No
camelCase/snake_case drift between Rust and TS — use `#[serde(rename_all =
"camelCase")]` on every public payload.

### R4 — Frontend service wrapper (`src/services/agentRegistry.ts`)

- Pure invoke wrapper module. No React. No `localStorage`.
- Exports: `listAgents()`, `refreshAgents(force?)`, `getAgent(id)`,
  `testCustomAgent(input)`, `saveCustomAgent(input)`, `deleteCustomAgent(id)`.
- Each function is a thin `invoke()` call returning the typed payload from
  R1. Throw on Tauri error (do not swallow).

### R5 — Persistence (`src-tauri/migrations/`)

- Add a new migration file (next free numeric prefix) creating table
  `agent_custom`:
  ```
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,        -- argv[0]
  args_json TEXT NOT NULL,      -- JSON array
  env_json TEXT NOT NULL,       -- JSON object
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  ```
- Register the new migration in `src-tauri/src/wise_db.rs` include list.
- No schema changes to existing tables.

### R6 — UI integration (single demo surface)

- Add **one** UI surface to prove the registry works end-to-end:
  - A "Agents" section inside an existing settings page (preferred:
    extend whichever settings panel currently houses Claude config — the
    implementer should pick the most natural existing host rather than
    creating a new top-level settings tab).
  - List rows: name, kind badge, available indicator, binary path,
    "Refresh" button.
  - Custom agent CRUD: add/edit/delete with a probe-before-save flow
    (probe failure surfaces the error string, save is blocked).
- No changes to chat / Mission / Trellis surfaces. The active-conversation
  swap card (AionUi `AgentSetupCard.tsx`) is **out of scope**.

### R7 — Tests

- Rust unit tests in `agent_registry.rs` for:
  - Dedup logic given mixed synthesized + custom inputs.
  - `failureReason` populated when probe fails.
  - Cache TTL respected with `force: false`; bypassed with `force: true`.
- Frontend tests in `src/types/detectedAgent.test.ts` for `isAgentKind`
  narrowing across all kinds.
- A focused service test (`src/services/agentRegistry.test.ts`) using
  `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))` to verify
  payload shape round-trip.

## Constraints

- **Tauri 2 only.** No Electron patterns: no `child_process.fork`, no
  `worker_threads`, no `contextBridge`. Probes go through `tauri-plugin-shell`
  or `tokio::process::Command`, never `std::process::Command` blocking.
- **Capability scope.** Add the minimum `shell` permission entries to
  `src-tauri/capabilities/default.json` to allow the chosen probe binaries;
  do **not** broaden to `shell:execute > *`.
- **No coupling to MCP, extensions, or Skills tasks.** Custom agent shape
  is intentionally minimal (command + args + env). Extension-contributed
  agents are explicitly **out of scope** and will be added by the extension
  task.
- **No `pages/` directory introduced.** Renderer module placement follows
  existing wise structure (`src/services/`, `src/components/`).
- **No `localStorage`** for registry state. SQLite for custom agents,
  in-process cache for probe results.
- **English only** in Rust/TS source. Comments minimal per project policy.
- **No dev-server or build commands** during implementation. `bun test` and
  `cargo test` are the verification surface.

## Acceptance Criteria

- [ ] `src/types/detectedAgent.ts` compiles, exports the union + type guard.
- [ ] `agent_registry_list` returns at least 3 entries on a host with none of
      Claude/Codex/Gemini installed (each marked `available: false` with a
      populated `failureReason`).
- [ ] On a host with Claude installed, `available: true` and `binaryPath` is
      a real path resolved by the probe.
- [ ] Adding a custom agent via the demo UI → DB row written →
      `agent_registry_list` includes it on next call without app restart.
- [ ] Deleting the custom agent removes it from both DB and the next list.
- [ ] `agent_registry_refresh(force=true)` re-probes every source; with
      `force=false` and within 30s, results come from cache (verifiable by
      timing or by mocking the probe in tests).
- [ ] No file outside the listed scope is modified.
- [ ] `bun test src/types/detectedAgent.test.ts src/services/agentRegistry.test.ts`
      passes.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml agent_registry`
      passes.
- [ ] `bunx tsc --noEmit` reports no new errors.

## Out of Scope

- Remote (WebSocket/HTTP) agent backends. The `kind` union deliberately
  omits `'remote'` for v1.
- Extension-contributed agents — added by the extension-system task.
- Hot-swap card above the chat input.
- Per-conversation model/mode/config selectors (AionUi
  `AcpConfigSelector`/`AcpModelSelector`/`AgentModeSelector` analogs).
- Migrating `claude_commands/*.rs` to consume the registry — that is a
  follow-up task; current call sites stay untouched.
- MCP, Skills, themes, settings tabs.

## Notes

- AionUi file references in this PRD point at the **patterns** to mirror.
  Do **not** copy code verbatim; AionUi is Electron-IPC and uses
  `bridge.buildProvider`, neither applicable to wise.
- This task is sized so an external agent (e.g., Codex) can complete it
  without holding the rest of the wise codebase in head.
- See `design.md` for the architecture sketch and `implement.md` for the
  step-by-step execution checklist.
