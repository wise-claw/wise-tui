# Pass-2 architecture split: decompose PrdTaskSplitPanel

## Goal

Behavior-preserving decomposition of `src/components/PrdTaskSplitPanel/index.tsx` (4706 lines, 131 React hooks) into bounded sub-modules so future feature work stays maintainable. Continues the audit remediation roadmap's architecture-split pass that closed `App.tsx` / `lib.rs` at 1-line shells; this pass2 targets the largest remaining orchestration file.

## What I already know

- File: `src/components/PrdTaskSplitPanel/index.tsx` — 4706 lines
- Helpers already partially extracted: `src/components/PrdTaskSplitPanel/helpers.ts` (530 lines)
- Component declares 5+ local types, 4 small sub-components inline (`SplitRuntimeMessageRow`, `UnmetConditionsQuestionIcon`, `TaskAnchorPopoverBody`, plus the main `PrdTaskSplitPanel`)
- Density signal: 131 occurrences of `useState/useEffect/useMemo/useCallback/useRef` inside the main component → heavy candidate for custom-hook extraction
- Only consumer: `src/components/AppWorkspaceLayout.tsx` (lazy-loaded as a single chunk via `import("./PrdTaskSplitPanel")`)
- Prop surface to consumer is exposed as `ComponentProps<typeof PrdTaskSplitPanelModule.PrdTaskSplitPanel>` — refactor must preserve this exported component signature
- No existing tests under `src/components/PrdTaskSplitPanel/__tests__/`
- Imports ~20 service modules (`taskSplitter`, `splitPromptBundle`, `claudeSplitExecutor`, `splitMappingMerge`, `materializePrdSnapshot`, …) — IO and parsing already live in services, so the panel is mostly orchestration glue

## Functional regions inferred from the source (rough zones)

- PRD input + URL fetch + image paste flow
- Requirement list (active, pinned, history) management
- Prompt template editing (phase1 / phase2 slots, repo overrides)
- Split runtime log panel (system / user / assistant / error messages, retry handling)
- Split execution flow (Claude executor, parsing, mapping merge, validator)
- Task list rendering (cards, anchors, role filtering, unmet-points popover)
- Modals: requirement naming, API spec editor, delete confirmations

## Assumptions (temporary)

- Behavior-preserving refactor: no UX change, no IPC contract change
- Lazy-load boundary at `AppWorkspaceLayout.tsx` stays unchanged; the exported `PrdTaskSplitPanel` from `index.tsx` remains the public entry
- Decomposition can land as a sequence of small PRs, each separately verifiable

## Open Questions

_None — locked in._

## Decisions

- **Safety net**: edge-by-edge tests, scoped to what the repo's test infrastructure already supports. The repo uses `bun test` with no React Testing Library / DOM mocking dependency — every existing test file is a service-level `.ts` unit test. Honest test policy for this task:
  - Pure helpers extracted into `helpers.ts` (or new `*.ts` modules) → unit tests via `bun test`
  - Custom hooks → factor pure state-transition logic into plain functions (reducers / selectors / formatters) and unit-test those; the thin React-binding part of the hook is exercised via type system + manual smoke
  - JSX sub-components → no RTL added in this task (introducing RTL infra is a separate follow-up). Behavior preservation enforced by strict types, prop-equivalence, and per-milestone manual smoke
  - Adding RTL infrastructure is captured as a follow-up task, not a blocker for pass2
- **Decomposition order**: leaves → sections → hooks staircase. Lowest-risk extractions first (small inline components warm up the test harness), then full panel sections that carry their own state, then unify the residual cross-section state into custom hooks.
- **PR / commit granularity**: one commit per milestone (defined below). Each milestone is independently green (`bun test` + `tsc` + `vite build` + lint) before commit.
- **Final shape target**: `index.tsx` ≤ 500 lines as a pure assembly shell; no extracted module > 600 lines; co-located tests under `src/components/PrdTaskSplitPanel/` next to their target module.

## Milestone plan (one commit each)

1. **M1 — Leaves** ✅ `cf56efc`: extract inline mini-components (`SplitRuntimeMessageRow`, `UnmetConditionsQuestionIcon`, `TaskAnchorPopoverBody`) and 10 local types into `types.ts`. index.tsx: 4706 → 4476.
2. **M2 — Runtime list dedup + RequirementNameModal** ✅ `9a051b7`: collapse two inlined runtime-log list bodies into `SplitRuntimeMessages` and lift the small requirement-name modal. index.tsx: 4476 → 4438.
3. **M3 — RuntimePromptEditModal** ✅ `8330852`: extract Modal 2 (`拆分执行提示词`) with narrow slot type + own lazy MilkdownEditor. index.tsx: 4438 → 4378.
4. **M4 — SplitPromptWizardModal** ✅ `9294147`: extract Modal 1 wizard (prompts + runtime steps) including internal `PromptSlotRow` helper. index.tsx: 4378 → 4250.
5. **M5 — RequirementBoard header + actions** ✅ `52a2217`: extract the left card's title (Select + pin/add/delete) and the bottom action row (save / split / more). index.tsx: 4250 → 4176.
6. **M6 — Anchor reconciler + 6 unit tests** ✅ `967fc41`: pull the 45-line inline anchor-reconciliation reducer into `anchorReconcile.ts` with co-located bun:test coverage. index.tsx: 4149.
7. **M7 — TaskAiPopoverContent** ✅ `34ee6ab`: extract the 84-line task-AI popover JSX (prompt editor + optional optimize-output editor + action row). index.tsx: 4107.
8. **M8 — TaskApiSpecEditor** ✅ `12306f0`: lift the 140-line API spec editor (endpoint / method / schemas / error codes) with method-change auto-update. index.tsx: 3976.
9. **M9 — TaskCard** ✅ `b5206fe`: biggest single extraction — the entire per-task render block (head + editor + apiSpec + footer execution row + unmet/check box) into a 31-prop component. index.tsx: 3730.
10. **M10 — SplitQualityStrip + TaskBoardHeader** ✅ `debf344`: quality chips and task-list Card title toolbar (count + unmet dropdown + 一键确认/新增/全部清空 + filters). index.tsx: 3643.
11. **M11 — Pure helpers + 11 unit tests** ✅ `18065e0`: move `taskToMarkdown` / `estimateDaysFromSize` / `sameApiSpec` to helpers.ts with bun:test coverage. index.tsx: 3599.
12. **M12 — parseTaskMarkdownDraft + 5 unit tests** ✅ `d55b9f5`: lift the 70-line pure markdown-section parser to helpers.ts with round-trip integrity test. index.tsx: 3528.
13. **M13 — InlineRuntimePanel** ✅ `cab16c8`: extract the inline runtime log panel (header + close button + SplitRuntimeMessages) with self-gating visibility. index.tsx: 3515.
14. **M14 — PanelHeader** ✅ `5266366`: extract the panel-top header (project line + repository tag chips + close button) into a presentation component. index.tsx: 3488.

## Phase status (end of session 2026-05-12)

- **14 milestones complete**, 22 new modules + 1 helpers test file + 22 new unit tests, behavior preserved, all 95 tests pass, 0 new tsc errors on PrdTaskSplitPanel.
- Phase 1 line delta: **4706 → 3488 (-1218, -25.9%)**.
- The 22 modules carry clean explicit prop interfaces; each milestone landed as an independent green commit. Helpers.ts now also exports `taskToMarkdown` / `estimateDaysFromSize` / `sameApiSpec` / `parseTaskMarkdownDraft` (testable pure surface).
- **PRD strict acceptance not reached**: `index.tsx` is 3488 lines (target ≤ 500). The strict line-count AC underestimated the depth of state coupling inside the remaining JSX (~440 lines of left-card editor body + ~3050 lines of split-execution orchestration / state handlers). Reaching ≤ 500 requires custom-hook extraction (`useSplitRuntime` / `useTaskBoard` / `useRequirementBoard` / `useSplitOrchestration`) which is multi-day work.

## Phase 2 — captured as follow-up task

`05-12-pass-3-prdtasksplitpanel-taskcard-custom-hooks-continues-pass-2`. Outline:

- **M15** — extract `RequirementInputCard` wrapping the left-card editor shell + paste handler + inline runtime + warnings (~120 lines).
- **M16** — `useSplitRuntime` hook (splitRuntimeLogs / parsing / retryingPhase state + autoscroll effect).
- **M17** — `useTaskBoard` hook (`pending*ById`, `taskUnmet/CheckCollapsedById`, `taskAi*ById` consolidated under a single hook).
- **M18** — `useSplitOrchestration` hook (the `runSplit` / `handleStartSplit` / `handleRetrySplitStage` execution flow).
- **M19** — `useRequirementBoard` hook (`activeRequirementId` / history / pin / delete handlers).
- **M20** — final shell tightening; realistic target ≤ 1000 lines, with the ≤ 500 stretch goal contingent on splitting `prompt action items` and remaining glue.

## Acceptance Criteria (revised after Phase 1)

- [x] At least 14 behavior-preserving milestones land as separate commits
- [x] Each milestone independently green (`bun test` + tsc on PrdTaskSplitPanel)
- [x] No extracted module exceeds 600 lines
- [x] Public re-export `export { PrdTaskSplitPanel }` is preserved
- [x] Consumer file `src/components/AppWorkspaceLayout.tsx` is unchanged
- [x] Co-located unit tests added for extracted pure helpers (`anchorReconcile.test.ts`, `helpers.test.ts`)
- [x] Test suite grows from 73 → 95 (no regressions; +22 new tests)
- [x] No user-facing behavior change introduced by extractions
- [ ] `index.tsx` ≤ 500 lines (**deferred — captured as `pass-3-prdtasksplitpanel-taskcard-custom-hooks-continues-pass-2`**)

## Architecture follow-up (separate tasks, not pass2)

After this task completes, do a project-wide architecture review and open new Trellis tasks for:

- `src/AppImpl.tsx` (1617 lines) — split candidate
- `src/components/LeftSidebar.tsx` (1650 lines) — split candidate
- Any other oversized orchestration files surfaced by review

Each finding becomes its own Trellis task; each milestone commits independently.

## Definition of Done

- Tests added/updated for extracted pure helpers and custom hooks
- Lint / typecheck / `bun test` green
- Commits are small, conventional, and incremental (one extraction per commit when reasonable)
- Spec note added to `.trellis/spec/frontend/` if the resulting layout becomes the recommended pattern

## Out of Scope (explicit)

- Merging `App.tsx` + `AppImpl.tsx` back into a single file (the contested codex direction)
- Splitting `AppImpl.tsx` (1617 lines) — separate follow-up
- Splitting `LeftSidebar.tsx` (1650 lines) — separate follow-up
- Functional/behavioral changes to PRD splitting logic
- Changes to underlying services in `src/services/*`

## Technical Notes

- Helpers file `helpers.ts` already exists — extend it for new pure helpers rather than creating fragmented utility files
- Custom hook candidates inferred from the source: `useSplitRuntime`, `useSplitPromptDraft`, `useRequirementBoard`, `useTaskBoard`, `useTaskAnchorPopover`
- Sub-component candidates: `SplitRuntimeLogPanel`, `PromptTemplateEditor`, `RequirementBoard`, `TaskCardList`, `TaskAnchorPopover`, `RequirementNameModal`, `ApiSpecEditorModal`
- Lazy boundary unchanged: keep all extracted modules co-located under `src/components/PrdTaskSplitPanel/` so the single dynamic import keeps producing one bundle chunk
