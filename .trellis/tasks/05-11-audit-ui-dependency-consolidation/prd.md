# PRD: Consolidate Frontend UI Framework Dependencies

## Problem

The app currently depends on both Ant Design and Semi UI. The audit finding calls out duplicated UI systems as a medium-priority maintainability risk. Mixed component systems can make styling, accessibility, bundle size, and design consistency harder to control.

This task should choose a pragmatic policy and execute only the first safe slice.

## Scope

- Inventory current Ant Design and Semi UI usage.
- Decide the primary UI system for new work.
- Document the policy in `.trellis/spec/frontend/component-guidelines.md` and/or README if needed.
- Remove unused UI dependencies only if usage inventory proves they are unused.
- If both are still required, define allowed domains for each and mark consolidation as incremental.

## Acceptance Criteria

- There is a written policy for new UI code.
- Dependency removal happens only after usage is verified.
- No visual regressions are introduced intentionally.
- `package.json` and lockfile stay consistent if dependencies change.
- `bun test` passes.

## Non-Goals

- Do not rewrite every component in one pass.
- Do not add a third UI system.
- Do not change desktop layout behavior as part of dependency cleanup.
