# Hook Guidelines

> How hooks are used in Wise.

---

## Overview

Hooks own reusable stateful orchestration: async service calls, Tauri event
subscriptions, process runtime state, persisted preferences, and multi-component
coordination. Components should remain focused on rendering and direct user
interaction.

Canonical examples:

- `src/hooks/useRepositoryList.ts` loads repositories/projects and exposes UI actions.
- `src/hooks/useClaudeSessions.ts` coordinates Claude process lifecycle and live output.
- `src/hooks/useWorkflowRun.ts` coordinates workflow runtime state.
- `src/hooks/useIntervalSyncedState.ts` throttles high-frequency mutable state into React renders.

---

## Custom Hook Patterns

Use `use<DomainThing>` names and return a named object when the hook exposes
several values or actions:

```ts
export function useRepositoryList() {
  const [repositories, setRepositories] = useState<Repository[]>([]);

  const refreshRepositories = useCallback(async () => {
    setRepositories(await loadRepositories());
  }, []);

  return {
    repositories,
    refreshRepositories,
  };
}
```

Rules:

- Keep service calls inside callbacks or effects, not during render.
- Return stable callbacks with `useCallback` when consumers pass them downward.
- Use functional `setState` when the next value depends on the previous value.
- Keep derived data in `useMemo` when it is non-trivial or used by dependencies.
- Keep temporary, non-rendering state in `useRef`.
- Clean up event listeners, intervals, subprocess subscriptions, and timers.

---

## Effects

Effects are for synchronizing with external systems: Tauri events, timers,
process streams, persisted settings, and IPC-backed data loading.

Do not use effects for simple derived render state. Prefer render-time
expressions or `useMemo`.

Good:

```ts
const activeProject = useMemo(
  () => projects.find((project) => project.id === activeProjectId) ?? null,
  [projects, activeProjectId],
);
```

Avoid:

```ts
useEffect(() => {
  setActiveProject(projects.find((project) => project.id === activeProjectId) ?? null);
}, [projects, activeProjectId]);
```

When an effect starts async work, guard stale completions if later state can
invalidate the result.

---

## Data Fetching

There is no HTTP server-state library in this project. Frontend data comes from:

- Tauri commands through `src/services/*`.
- Tauri events through `src/services/events.ts` or direct listener wrappers.
- Local browser APIs for UI-only runtime preferences.
- In-memory stores for app-runtime subscriptions.

Use `Promise.all` for independent IPC reads, as in `useRepositoryList.ts`.
Normalize or validate data before putting it into shared state.

---

## Runtime Streams

Claude execution, terminal sessions, monitor data, and workflow runs can produce
high-frequency updates. Avoid rendering for every byte or event.

Use these patterns:

- Store fast-changing buffers and process handles in refs.
- Promote snapshots into React state on intervals or meaningful boundaries.
- Keep cancellation and cleanup paths explicit.
- Avoid stale closure bugs by reading latest mutable values from refs.
- Keep event names in `src/constants/*` when reused across modules.

### Pattern: Stream Snapshot Fingerprints

**Contract**: Fingerprints for high-frequency stream state should include structural fields that change UI meaning, not the full streaming body. For Claude sessions this means status, message count, last message identity/role, and user-turn boundary; assistant body length should be ignored while the session is `running` or `connecting`.

```ts
const isStreaming = session.status === "running" || session.status === "connecting";
const fingerprintPart = [
  session.id,
  session.status,
  String(session.messages.length),
  String(indexOfLastRenderableUserMessage(session.messages)),
  last?.id ?? "",
  last?.role ?? "",
  isStreaming ? "" : settledPreviewBucket,
].join("|");
```

**Why**: Token streaming can update content many times per second. Periodic hooks that scan full message bodies or duplicate the same fingerprint timer can create global UI stutter.

**Tests Required**: Cover both sides of the contract: streaming body growth does not change the fingerprint, while status, appended messages, last user boundary, and settled preview buckets do.

---

## Naming Conventions

- Hook file: `src/hooks/useThing.ts`.
- Hook export: `useThing`.
- Returned callbacks: verbs such as `refresh`, `select`, `start`, `stop`, `retry`.
- Internal refs: suffix with `Ref`, for example `sessionsRef`.
- Internal timers: suffix with `TimerRef` or `IntervalRef`.

---

## Common Mistakes

- Starting long-running work without cleanup.
- Storing every stream chunk in React state.
- Omitting dependencies instead of restructuring a callback or using a ref.
- Returning arrays from complex hooks, which makes call sites hard to read.
- Putting pure parsing or normalization inside hooks instead of a tested service or utility.
- Letting hooks silently swallow errors that should be visible in the UI.
