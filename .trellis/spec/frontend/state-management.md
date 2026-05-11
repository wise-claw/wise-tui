# State Management

> How frontend state is managed in Wise.

---

## Overview

Wise uses React state, refs, small subscription stores, Tauri IPC services, and
SQLite-backed app settings. There is no Redux, Zustand, React Query, or router
state layer.

State ownership should match lifetime and scope:

- Component-local state for local UI.
- Hook state for reusable or multi-step orchestration.
- `App.tsx` state for desktop-shell coordination only.
- Service/store modules for cross-feature runtime or persisted data.
- Rust/SQLite for durable application state.

---

## State Categories

| Category | Use | Examples |
|----------|-----|----------|
| Local UI state | Modal open state, selected tab, input draft | Feature components |
| Hook orchestration state | Repository list, Claude sessions, workflow run state | `useRepositoryList`, `useClaudeSessions`, `useWorkflowRun` |
| App-shell state | Active project/repository, global panels, shared layout | `src/App.tsx` |
| Runtime store state | Cross-component subscriptions that are not persisted by React tree ownership | `src/stores/`, `src/notifications/` |
| Persisted app state | Settings, projects, workflow graphs, task snapshots | `src/services/*` + Tauri commands + SQLite |
| Transient process state | Live stdout buffers, process IDs, timers | refs inside hooks |

---

## Local State

Keep state local when:

- Only one component needs it.
- It is purely presentational.
- Losing it on unmount is acceptable.
- It is a draft value before explicit save.

Promote state only when another feature actually needs to read or mutate it.

---

## App-Level State

`src/App.tsx` coordinates the desktop workspace. Add state there only for
cross-panel behavior that cannot live in a feature hook, such as:

- Active repository/project selection.
- Global app panels and drawers.
- Window-level keyboard shortcuts.
- Cross-feature event routing.

Do not use `App.tsx` as a dumping ground for feature internals. Extract feature
state into `src/hooks/` or `src/services/` when the state has a clear domain name.

---

## Persisted State

Use the existing persistence layer:

- `src/services/appSettingsStore.ts` for generic key/value settings.
- Domain services such as `projectState`, `workflowGraphs`, `workflowTasks`,
  and task split stores for structured persisted data.
- Rust commands and `src-tauri/src/wise_db.rs` for durable SQLite-backed data.

`localStorage` is allowed only for UI/runtime preferences where the codebase
already uses that pattern. Durable project, workflow, task, repository, and
session metadata should go through services and Rust persistence.

Version or validate JSON blobs before depending on their shape.

---

## IPC State

Tauri IPC is the project's server-state boundary.

- Components call services, not `invoke`.
- Services expose typed functions with trimmed/normalized inputs.
- Hooks decide loading, error, retry, optimistic updates, and UI refresh behavior.
- Long-running backend work should expose events or snapshots rather than force
  components to poll blindly.

When multiple independent reads are needed, start them together with
`Promise.all`.

---

## Derived State

Prefer deriving state during render:

```ts
const projectRepositories = useMemo(() => {
  if (!activeProject) return [];
  const byId = new Map(repositories.map((repo) => [repo.id, repo]));
  return activeProject.repositoryIds
    .map((id) => byId.get(id))
    .filter((repo): repo is Repository => Boolean(repo));
}, [activeProject, repositories]);
```

Avoid storing derived copies unless:

- The user can edit the copy independently.
- The data is a cached snapshot from an external source.
- Derivation is expensive and memoization is insufficient.

---

## Common Mistakes

- Persisting durable data in `localStorage`.
- Keeping process stream buffers in React state.
- Duplicating backend state in several components without a single refresh path.
- Swallowing service errors and leaving UI state stale.
- Storing derived selections that can drift from source arrays.
- Adding global state for a one-component interaction.
