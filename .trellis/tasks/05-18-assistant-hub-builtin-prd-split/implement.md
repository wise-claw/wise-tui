# Implement — Assistant Hub PRD Split Convergence

## 0. Current Execution Truth

Follow `design.md`. Do not implement or revive:

- ChatPane.
- ArtifactPane tabs for PRD/design/implement/tasks.
- `useAssistantConversation`.
- `mission_record_chat_event`.
- true Claude tool-use dispatch for PRD editing or `start_splitter`.
- a new `ViewMode` kind.

The active direction is:

```text
CockpitSurface
  -> AssistantHub
  -> AssistantHeader
  -> AssistantConversationView
     -> builtin:prd-split renders PrdTaskSplitPanel
  -> AssistantSettingsDrawer
```

The PRD-split product flow is:

```text
PRD input/import
  -> split fan-out
  -> candidate task review
  -> orchestration confirmation
  -> Trellis materialization
  -> runtime queue
```

## 1. Already Landed / Preserve

Preserve these unless a focused bug fix requires touching them:

- Migrations:
  - `027_assistant_id.sql`
  - `028_assistant_overrides.sql`
  - `029_migrate_prompt_layers_into_assistant_overrides.sql`
- Backend assistant runtime:
  - `src-tauri/src/assistants/builtins/*`
  - `src-tauri/src/assistants/overrides.rs`
  - `src-tauri/src/assistants/runtime_resolver.rs`
  - `assistants_resolve_runtime`, `assistants_save_overrides`, `assistants_reset_overrides`
- Task artifact backend:
  - `src-tauri/src/task_artifact.rs`
  - `mission_create_with_task`
  - `read_task_artifact`
  - `write_task_artifact`
- Frontend assistant runtime:
  - `src/services/assistantPromptLayers.ts`
  - `src/services/resolveSplitPromptLayers.ts`
- Cockpit shell:
  - `src/components/CockpitSurface/index.tsx`
  - `AssistantHub.tsx`
  - `AssistantHeader.tsx`
  - `AssistantConversationView.tsx`
  - `AssistantSettingsDrawer.tsx`
- PRD split orchestration work:
  - `ExecutionOrchestrationPanel.tsx`
  - `ExecutionRuntimeQueue.tsx`
  - `executionOrchestrationModel.ts`
  - `executionPlanAdjustments.ts`

## 2. Remaining Work

### 2.1 Documentation and Context Cleanup

- [ ] Keep `prd.md`, `design.md`, and `implement.md` aligned around D13-D16.
- [ ] Remove stale `ChatPane`, `ArtifactPane`, `tool use`, `intent fence`, and `chat_message` references from Trellis manifests.
- [ ] Ensure `CLAUDE.md` and frontend specs describe `CockpitSurface` and `PrdTaskSplitPanel` as the active PRD-split assistant path.

### 2.2 Assistant Hub / Header Polish

- [ ] Ensure `AssistantHub` renders all builtin assistants returned by `assistants_list`; do not special-case only `builtin:prd-split`.
- [ ] Keep Chinese labels for builtin UI.
- [ ] Keep Hub close/back behavior consistent with `chat` as the default working surface.
- [ ] Keep `CockpitSubMode` local to `CockpitSurface`.
- [ ] Verify `AssistantHeader` uses the selected assistant metadata and active workspace label.

### 2.3 PRD Split Assistant Surface

- [ ] Keep `AssistantConversationView` as a thin wrapper:
  - `builtin:prd-split` -> lazy `PrdTaskSplitPanel`.
  - other assistants -> lightweight artifact brief workspace.
- [ ] Do not reintroduce `MissionControl.tsx` as the primary entry for PRD-split assistant.
- [ ] Preserve PRD anchor behavior in `PrdTaskSplitPanel`:
  - selecting a task highlights/scrolls PRD anchors.
  - requirement selection syncs to derived tasks.
  - anchor fallbacks stay secondary to explicit `taskAnchors`.

### 2.4 Split Fan-out Runtime

- [ ] Keep split runtime copy as "拆分 fan-out 运行图".
- [ ] Show cluster splitter progress, verifier/merge status, and retry actions.
- [ ] Ensure split errors remain actionable and do not look like chat failures.
- [ ] Keep `trellis-splitter` / `trellis-verifier` prompt contracts in sync with normalized output expectations:
  - `taskAnchors`
  - `sourceRequirementIds`
  - `dependencies`
  - `dependencyRationale`
  - `sourceRefs`

### 2.5 Orchestration Confirmation

- [ ] Candidate task confirmation enters `resultViewMode = "orchestration"`.
- [ ] `PrdTaskSplitPanelImpl` switches `workspaceLayout` to `focused` for orchestration and runtime queue.
- [ ] The PRD panel collapses without unmounting.
- [ ] `ExecutionOrchestrationPanel` shows:
  - requirement -> task trace.
  - wave/DAG board.
  - fixed serial-chain drop target.
  - fan-out agent mapping.
  - conflict warnings.
- [ ] Task movement updates `TaskItem.dependencies`, then refreshes `parallelGroups`.
- [ ] Invalid dependency edits return no-op with user-visible feedback when needed.

### 2.6 Materialization and Runtime Queue

- [ ] "落盘执行" is a stage-rail action after orchestration confirmation.
- [ ] Materialization uses confirmed `parallelGroups` and existing Trellis writer/fan-out bridge.
- [ ] After materialization, hide the editable candidate list and show `ExecutionRuntimeQueue`.
- [ ] Runtime queue displays wave, task, subagent, dependency, and disabled placeholders for unsupported destructive actions.
- [ ] Existing monitor surfaces should consume the same run facts instead of duplicating task state.

### 2.7 Assistant Settings Drawer

- [ ] Preserve lightweight drawer scope:
  - assistant/project scope.
  - Skills enable/disable and mount.
  - MCP enable/disable.
  - engineering preferences.
- [ ] Do not resurrect the old `PromptsPanel`.
- [ ] If prompt editing is needed later, add it inside the drawer using the existing `assistant_overrides` runtime contract.

### 2.8 Audit Fields

- [ ] New mission/run write paths should pass `assistant_id`.
- [ ] Old rows with `assistant_id IS NULL` remain readable.
- [ ] Any UI text for old rows should label them as historical/pre-assistant data, not errors.

## 3. Validation Commands

Run focused checks for changed areas:

```bash
bun test src/components/CockpitSurface
bun test src/components/PrdTaskSplitPanel
bun test src/services/prdSplit
bun test src/services/assistantPromptLayers.test.ts
```

For Tauri/runtime changes:

```bash
cargo check
cargo test
```

Run from `src-tauri/` for Cargo commands. Do not run dev/preview/serve commands unless explicitly approved.

## 4. Final Acceptance Checklist

- [ ] Full-text search finds no active implementation plan for `ChatPane`, `ArtifactPane`, `useAssistantConversation`, `assistant_tool_dispatch`, or `mission_record_chat_event`.
- [ ] `builtin:prd-split` opens `PrdTaskSplitPanel`.
- [ ] Split fan-out runtime is visible and retryable.
- [ ] Candidate tasks show PRD traceability.
- [ ] Orchestration confirmation shows waves and conflicts before materialization.
- [ ] Materialization transitions to runtime queue.
- [ ] Assistant settings persist skill/MCP/engineering overrides.
- [ ] `ViewMode` remains `chat | cockpit | author | inspect`.
- [ ] Tests above pass or failures are documented with cause.

## 5. Commit Shape

Keep commits scoped:

1. Documentation/context convergence.
2. Cockpit/assistant surface fixes if needed.
3. PRD split orchestration fixes if needed.
4. Validation/spec updates.

Do not mix unrelated UI cleanup, Author panel refactors, or backend command deletion into this task.
