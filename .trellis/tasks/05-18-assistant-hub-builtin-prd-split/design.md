# Design — Assistant Hub PRD Split Convergence

## 0. Effective Scope

This document supersedes the older ChatPane / ArtifactPane / true tool-use plan that still appears in early decision history. The current implementation follows D13-D16:

- `builtin:prd-split` is a Wise/Trellis orchestration assistant, not a chat product.
- The conversation surface is `AssistantHeader + PrdTaskSplitPanel`.
- PRD splitting remains form-driven: edit/import PRD, split, review candidate tasks, confirm orchestration, then materialize and fan out.
- Claude/LLM calls stay inside splitter / verifier / task-refine paths. There is no `ChatPane`, no artifact markdown tab set, and no `assistant_tool_dispatch` loop in this task.
- Existing backend additions from Stage 1/2 stay: `assistant_id`, `assistant_overrides`, `runtime_resolver`, and `task_artifact` APIs. They are useful for assistant configuration and future artifact assistants, but not the PRD-split primary UX.

## 1. Product Shape

Wise keeps four top-level views only:

```ts
type ViewMode =
  | { kind: "chat" }
  | { kind: "cockpit"; missionId?: string }
  | { kind: "author"; pane: AuthorPane }
  | { kind: "inspect"; tool: InspectTool };
```

`cockpit` owns an internal assistant sub-state:

```ts
type CockpitSubMode =
  | { kind: "hub" }
  | { kind: "conversation"; assistantId: string };
```

This state remains local to `CockpitSurface`; it must not become a new `ViewMode` kind or global store.

## 2. Component Boundaries

```text
ViewMode kind="cockpit"
  -> CockpitSurface
     -> AssistantHub
        - lists builtin / custom / extension assistants
        - groups builtin assistants by product role
        - opens selected assistant conversation
     -> AssistantHeader
        - shows assistant identity, workspace, engine, chat/settings actions
     -> AssistantConversationView
        - if assistantId === builtin:prd-split:
            lazy-render PrdTaskSplitPanel
        - else:
            render lightweight artifact-assistant brief workspace
     -> AssistantSettingsDrawer
        - assistant/project scope
        - skill bundle enable/disable and mount
        - MCP bundle enable/disable
        - engineering preferences
```

`MissionControl.tsx` is no longer the product entry for the PRD-split assistant. Some Mission components and persistence APIs can remain as runtime evidence and compatibility surfaces, but new PRD-split UX must route through `CockpitSurface -> AssistantConversationView -> PrdTaskSplitPanel`.

## 3. Data Contracts

### 3.1 Assistant Identity

Migration `027_assistant_id.sql` adds:

- `mission_runs.assistant_id`
- `mission_runs.task_dir`
- `mission_agent_assignments.assistant_id`
- `trellis_agent_runs.assistant_id`

Existing rows keep `NULL`; UI treats them as pre-assistant history.

### 3.2 Assistant Overrides

Migration `028_assistant_overrides.sql` stores one row per `(assistant_id, scope)`:

```text
scope = "assistant" | "project:<id>" | "repository:<id>"
```

Runtime merge order:

```text
builtin assistant defaults
  -> assistant scope override
  -> project scope override
  -> repository scope override
```

Frontend then merges the resolved assistant prompt slot with platform split-prompt defaults where required.

### 3.3 PRD Split Task Data

`TaskItem` is the shared unit for candidate review, orchestration, and materialization. The fields that matter for this task are:

- `sourceRequirementIds`: PRD requirement trace.
- `taskAnchors`: PRD text anchor for highlight/scroll.
- `dependencies`: DAG edges.
- `dependencyRationale`: human-readable reason for dependency edges.
- `sourceRefs`: expected file/directory touch points and conflict inputs.
- `splitListEmployeeName`: explicit subagent display name when available.
- `parallelGroups`: wave layout derived from dependencies.

## 4. Main Loop

```text
User selects Workspace
  -> Cockpit Hub
  -> builtin:prd-split
  -> AssistantHeader + PrdTaskSplitPanel
  -> PRD edit/import
  -> split fan-out: clusters -> trellis-splitter agents -> verifier/merge
  -> candidate task review with anchors
  -> orchestration confirmation: dependencies -> waves -> fan-out plan
  -> materialize Trellis tasks
  -> execution runtime queue
```

## 5. PRD Split Fan-out

Splitting is the first fan-out layer:

| Layer | Input | Worker | Output |
|---|---|---|---|
| Split fan-out | PRD clusters | `trellis-splitter` | candidate tasks, anchors, dependencies, rationale |
| Verify/merge | splitter outputs | verifier/normalizer | merged `SplitResult` |
| Orchestration | `SplitResult` | local dependency model, later reviewers | waves and dispatch plan |
| Execution | confirmed waves | implement/check agents | code changes and evidence |

`runPrdSplitSubagentWorkflow` keeps its role: plan clusters, create parent tasks, dispatch splitters, normalize, and merge results. It should not become a chat-session runner.

## 6. Orchestration Confirmation

Candidate tasks are not execution input. Execution input is the dependency-derived plan:

```ts
interface ExecutionPlan {
  waves: Array<{
    index: number;
    taskIds: string[];
    dependsOn: string[];
  }>;
}
```

The first implementation derives this from existing fields:

- `TaskItem.dependencies`
- `SplitResult.parallelGroups`
- `buildParallelGroups`
- `workflowGraphFromSplit.buildDependencyLayers`

The UI state is:

```ts
type ResultViewMode = "review" | "orchestration";
type SplitWorkspaceLayout = "review" | "focused";
```

Rules:

- `review`: left PRD panel is visible; right side shows candidate task cards.
- `orchestration`: left PRD panel collapses without unmounting; right side owns the full width.
- `executionStarted`: candidate list switches to runtime queue.

The orchestration view shows:

- requirement -> task -> agent -> sourceRefs trace.
- wave/DAG board.
- fixed serial-chain drop target.
- fan-out dispatch mapping.
- same-wave file/resource conflict warnings.

Drag or button adjustments modify `TaskItem.dependencies`, then recompute `parallelGroups`. Invalid dependency graphs are rejected.

## 7. Conflict and Dependency Semantics

The local orchestration model must surface:

- same-wave `sourceRefs` conflicts.
- missing `sourceRefs` as quality/monitoring metadata, not as the task card's primary title.
- concrete agent labels, preferring `splitListEmployeeName`, then role/sourceRef heuristics.
- common engineering dependencies, especially auth foundation before JWT/token/interceptor/guard work.

Future splitter output should include optional:

```ts
agentHint?: string;
conflictHints?: string[];
```

Until the shared `TaskItem` contract adds those fields, use existing `sourceRefs`, `splitListEmployeeName`, `role`, and `dependencyRationale`.

## 8. Assistant Settings

`AssistantSettingsDrawer` is the L3 configuration surface. The current scope is intentionally lightweight:

- assistant/default and project scope switching.
- skill bundle enable/disable and skill mounting from local skill paths.
- MCP bundle enable/disable.
- engineering preferences such as `reuseExistingParents`, `dispatchOnlyDirty`, and format profile.

Prompt editing can remain in the resolved runtime/prompt layer for now; do not reintroduce the old `PromptsPanel` as a separate product surface.

## 9. Inspectors

The `inspect` view remains a separate overlay domain. Runtime/spec/workflow graph inspectors may continue to evolve, but they should not become new top-level modes and should not be required for the PRD-split primary flow.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Old docs revive ChatPane/tool-use scope | This document is the effective design; `implement.md` mirrors it. |
| Assistant settings overreach into prompt workshop rewrite | Keep drawer lightweight; use existing runtime resolver and avoid resurrecting `PromptsPanel`. |
| Candidate task list gets executed directly | Route execution through orchestration confirmation and `parallelGroups`. |
| DAG edits introduce cycles or stale waves | Every dependency edit reruns `validateTaskDependencies` and `refreshSplitResultDerivedFields`. |
| Same-wave file conflicts are hidden | Use `sourceRefs` conflict warnings in orchestration before materialization. |

## 11. Acceptance

- Assistant Hub lists all builtin assistants and opens `builtin:prd-split`.
- `builtin:prd-split` renders `PrdTaskSplitPanel`; no ChatPane/ArtifactPane/tool-use loop exists.
- Assistant settings persist skill/MCP/engineering overrides through `assistant_overrides`.
- Split fan-out runtime is visible as splitter/verifier progress, not chat.
- Candidate tasks carry anchors and support PRD highlight/scroll.
- Orchestration confirmation collapses PRD input, shows waves, dispatch plan, conflicts, and traceability.
- Materialization happens after orchestration confirmation and transitions to runtime queue.
- `assistant_id` is written for new mission/run audit rows where that path creates them; old rows remain readable as history.
