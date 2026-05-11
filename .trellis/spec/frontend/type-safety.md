# Type Safety

> TypeScript and runtime validation conventions for Wise.

---

## Overview

The frontend uses TypeScript strict mode. Treat types as contracts across
components, hooks, services, and Tauri commands. Runtime validation is required
at untrusted boundaries: IPC payloads, persisted JSON, user-provided text, LLM
outputs, and imported files.

Important compiler settings:

- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `isolatedModules: true`
- `jsx: react-jsx`

---

## Type Organization

- Keep component-local prop types in the component file.
- Keep cross-feature legacy/shared types in `src/types.ts`.
- Add domain-specific type modules under `src/types/` when the domain is
  substantial or shared.
- Workflow types belong in `src/types/workflow.ts`.
- Requirement split types belong in `src/types/requirementsIndex.ts` and related modules.
- Use `import type` for type-only imports.

Example:

```ts
import type { Repository } from "../types";
```

---

## Frontend/Rust DTO Contracts

Frontend DTO field names should be `camelCase`. Rust structs returned to the
frontend should use Serde camel-case conversion:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WiseProjectRow {
    pub repository_ids: Vec<i64>,
}
```

Tauri command argument names must match the frontend `invoke` payload keys.
Keep these names explicit in `src/services/*` wrappers.

---

## Runtime Validation

Validate data when TypeScript cannot prove the shape:

- Parsed JSON from `localStorage`, SQLite settings, files, or LLM output.
- Data crossing plugin, MCP, terminal, Claude, or browser boundaries.
- Any IPC response using `unknown`, `serde_json::Value`, or stringified JSON.

Use small validators or type guards when a full schema library is not already
part of the project. `src/services/workflow/acceptanceVerdict.ts` is the model:

```ts
export function validateWorkflowAcceptanceVerdictPayload(
  input: unknown,
): { ok: true; value: WorkflowAcceptanceVerdictPayload } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["not_object"] };
  }
  // Validate every required field before returning a typed value.
}
```

---

## Common Patterns

Use discriminated unions for state machines:

```ts
type RunStatus =
  | { kind: "idle" }
  | { kind: "running"; runId: string }
  | { kind: "failed"; error: string };
```

Use type predicates when filtering nullable values:

```ts
const visibleRepositories = ids
  .map((id) => byId.get(id))
  .filter((repo): repo is Repository => Boolean(repo));
```

Use literal tuples for fixed sets:

```ts
const STAGE_ORDER = ["split", "clarify", "implement", "verify", "review", "delivery"] as const;
```

---

## Forbidden Patterns

- Do not use `any` for new code.
- Do not cast parsed JSON directly to a shared type without validation.
- Do not use non-null assertions to silence uncertain data flow.
- Do not weaken command wrappers to `Promise<unknown>` when the response type is known.
- Do not mix `snake_case` frontend DTO fields with `camelCase` UI types.
- Do not hide type errors by broadening values to `string | number | boolean`
  when a domain union is known.

When a third-party API forces a cast, keep it local, narrow it immediately, and
explain the boundary if the reason is not obvious.
