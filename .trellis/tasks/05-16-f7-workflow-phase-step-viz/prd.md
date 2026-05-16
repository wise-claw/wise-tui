# F7 visualize .trellis/workflow.md phases and hooks

## Parent

`05-16-mission-control-acceptance-closeout/design.md §7` 与 `implement.md Step 7`。

## Scope

1. 新增 `src/components/MissionControl/engineering/WorkflowGraphPanel.tsx`：调用 `compileTrellisWorkflow({ projectId, rootPath })`（service 已存在），按 phase 折叠展示 step list、平台分支 tag、validation issue badge。
2. 接到 `EngineeringDrawer` 作为 "Workflow" tab。
3. 与 `SpecRevisionTimeline` 协作：选中 revision 时 panel 高亮匹配 step（按 `step.filePath` 与 `revision.filePath` 简单匹配）。
4. 异常状态：command 失败 → 空状态 + 重试按钮。

## Out of Scope

- 不解析 platform 块的详细差异（仅 tag 展示）。
- 不实现 step 间 SVG 流程图（折叠列表足够覆盖功能需求 6.1）。
- 不修改 `trellis_runtime_compile_workflow` Rust 实现。

## Acceptance

- [ ] EngineeringDrawer 出现 "Workflow" tab，渲染当前项目的 phase / step 列表。
- [ ] validation_issues 显示为 badge。
- [ ] 选中 spec revision 时对应 step 高亮。
- [ ] command 失败时显示空状态与重试按钮，不崩溃。
- [ ] `bun test src/components/MissionControl/engineering` + `bunx tsc --noEmit` 通过。
