# IPC Guidelines

> How Tauri commands, events, DTOs, and long-running backend work are structured.

---

## Command Boundary

Every Rust command exposed to the frontend must have a typed service wrapper in
`src/services/*`. Components and hooks call the wrapper, not `invoke` directly.

Frontend:

```ts
export async function loadRepositories(): Promise<Repository[]> {
  try {
    return invoke<Repository[]>("list_repositories");
  } catch {
    return [];
  }
}
```

Rust:

```rust
#[tauri::command]
fn list_repositories() -> Result<Vec<Repository>, String> {
    // Read, validate, and return frontend DTOs.
}
```

Use direct `invoke` imports only inside service modules or narrowly scoped
infrastructure wrappers.

---

## Return Types and Errors

- Commands should return `Result<T, String>` unless Tauri or a plugin requires a different shape.
- Error strings should be user-safe and actionable.
- Preserve the existing style of Chinese user-facing backend errors where nearby commands use it.
- Do not return raw debug dumps, secrets, environment values, or full command lines containing tokens.
- Convert internal errors close to their source with `map_err(|e| e.to_string())`
  or a clearer domain message.

---

## DTO Naming

- Frontend payload keys are `camelCase`.
- Rust command argument names should match frontend payload keys after Tauri's argument mapping.
- Serialized Rust structs should use:

```rust
#[serde(rename_all = "camelCase")]
```

This keeps TypeScript types and UI code idiomatic while Rust fields remain
snake_case.

---

## Long-Running Work

Claude execution, terminal sessions, workflow automation, CUA, and monitoring
are long-running flows. They need explicit lifecycle handling:

- Start commands should return an ID or enough data to bind frontend state.
- Runtime output should be delivered through events, snapshots, or explicit polling APIs.
- Cancellation paths must be part of the design.
- Process handles should live in managed backend state or a clearly owned registry.
- Frontend hooks should clean up event listeners when components unmount or sessions close.

Do not block the UI on a command that can stream or emit progress.

---

## Events

Use events for cross-window or long-running backend updates. Keep event names in
frontend constants when multiple modules consume them.

Event payloads should be structured DTOs, not ad hoc strings. Include IDs that
allow the frontend to route the event to the correct repository, session,
workflow run, task, or window.

---

## State Management

Use Tauri managed state for shared backend resources:

- SQLite handle: `WiseDb`.
- Process/session registries.
- Global shortcut or window-related state.
- Long-lived clients or runtime services.

Protect shared mutable data with `Mutex` or async-safe locks as appropriate.
Return a clear error if a lock is poisoned.

---

## Command Registration

Register commands in one place with the surrounding command group in
`src-tauri/src/lib.rs`. Prefer moving large new domains into their own Rust
module and registering their command functions from the app setup layer.

Do not continue growing `lib.rs` for a new domain if the domain has multiple
commands, helper types, or filesystem rules.

---

## Common Mistakes

- Calling `invoke` directly from UI components.
- Returning unvalidated `serde_json::Value` and casting it on the frontend.
- Adding a command without cancellation or event strategy for long-running work.
- Forgetting that frontend argument keys must match the Rust command contract.
- Returning backend-only error detail that is not useful or safe for users.

---

## Dead Code Hygiene

Resolve Rust dead-code warnings deliberately: **delete** when there is no documented near-term consumer (command not in `invoke_handler!`, DTO field never persisted, orphaned helper); **allow** with `#[allow(dead_code)]` plus a one-line WHY comment naming the upcoming consumer when the item is in-progress engine/refactor scaffolding (e.g. `src-tauri/src/mcp/` protocol traits, extension classifier hooks). No allow without a documented consumer.
