# Implement

## Checklist

1. Create unified target resolver. ✅
   - Add a pure module for Workspace / Standalone Repo target resolution.
   - Cover single-repo Workspace, multi-repo Workspace, standalone repo, and invalid target in tests.

2. Extract headless runtime adapter. ✅ first pass
   - Wrap existing `PrdSplitWizard` reducer/state and `MissionControl/actions/runMissionActions.ts`.
   - Do not preserve old UI as a compatibility goal.
   - Expose target, stage, cluster runs, plan, retry/cancel hooks.

3. Connect `PrdTaskSplitPanel` to target. ✅ first pass
   - Replace scattered `contextMode`/linked project/repository execution semantics where practical.
   - Keep existing PRD editor/import/task editing features intact.
   - Surface target and stage in the header.

4. Align execution boundary.
   - Ensure preview/planning does not create Trellis parent tasks.
   - Execution path goes through Mission/Trellis ledger-aware actions.
   - Preserve stdout/stderr/runDir/Claude session id in displayable state.
   - Remove the legacy one-shot `subagentWorkflow` service once `PrdTaskSplitPanel` runs through the controller.

5. First-pass UI cleanup.
   - Reduce empty-card feel.
   - Add clear target/stage strip and useful empty states.
   - Keep visual change scoped; do not redesign the whole assistant in this task.

6. Tests and verification.
   - Run focused tests for target resolver and affected controller logic.
   - Run related PRD split / Mission tests.
   - Do not run dev server.

## First-Pass Result

- `PrdSplitWizard/targetModel.ts` now exposes `TrellisTarget` and `resolveTrellisTarget`.
- `PrdTaskSplitPanel` consumes the resolved target for context, splitter root, and Trellis materialization root.
- Added `TrellisMissionStrip` to surface target, root, execution repo, and stage.
- Added `useRequirementMissionController` as the headless adapter around Wizard state and Mission actions.
- Mission runtime tests now mock `resolveMaterializedFanoutRepositoryTarget`, matching the real module surface.

## Deletion Slice

- Removed old `PrdSplitWizardModal` / `Host` event shell.
- Removed obsolete `MissionControl/MissionControl.tsx` full-screen UI shell plus unmounted presenter/detail/setup/canvas components.
- Kept `MissionControl/actions/*`, `useMissionLedger`, and Trellis runtime Inspector components that are still active.
- Removed the `PrdSplitWizard` barrel export that only existed for legacy UI exports.
- Removed `src/services/prdSplit/subagentWorkflow.ts` and its isolated test. The product path now runs through `useRequirementMissionController` + `runMissionActions`, so there is no second splitter orchestration path.
- Moved cluster split result merging / task id namespacing into `src/services/prdSplit/clusterSplitResultMerge.ts` with focused tests.

## Likely Files

- `src/components/PrdSplitWizard/targetModel.ts`
- `src/components/PrdSplitWizard/useSplitWizardState.ts`
- `src/components/MissionControl/actions/runMissionActions.ts`
- `src/components/PrdTaskSplitPanel/usePrdTaskSplitPanelController.tsx`
- `src/components/PrdTaskSplitPanel/PrdTaskSplitPanelImpl.tsx`
- `src/components/PrdTaskSplitPanel/*.css`
- `src/services/prdSplit/*`
- `src/services/trellisRuntime.ts`
- `src/services/missionControlBackend.ts`

## Validation

```bash
bun test src/services/prdSplit/clusterSplitResultMerge.test.ts src/components/PrdSplitWizard/targetModel.test.ts src/components/PrdSplitWizard/useSplitWizardState.test.ts src/components/MissionControl/actions/runMissionActions.test.ts src/components/PrdTaskSplitPanel
```

Latest focused result: 72 pass / 0 fail.

`bunx tsc --noEmit --pretty false` still fails on existing unrelated global type debt:

- `assistantHubActive` missing from `LeftSidebarProps`
- `onCompactSessionHistory` missing from `RightPanelProps` / another `Props`
- `onOpenSettings` missing from `LeftSidebarTopbarProps`
- `SessionQuickActionsLayoutV1` unused
- `useSidebarCodeGraphIndexMap` index expression issue
- `WorkflowConfigModal` `ModalStylesType.content`
- `safeUnlistenPromise` unused

The broad component target is currently clean for this slice.

## Rollback

- Keep new target resolver and controller adapter connected through `PrdTaskSplitPanel`.
- Old MissionControl/Wizard UI and legacy subagent workflow are deleted; keep runtime actions, service wrappers, database contracts, and tests.
- If controller integration becomes too broad, stop after Target + UI target strip and leave execution migration as the next Trellis task.
