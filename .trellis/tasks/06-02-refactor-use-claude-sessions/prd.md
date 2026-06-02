# Refactor useClaudeSessions into modules

## Goal

将 `src/hooks/useClaudeSessions.ts` 从超大单文件重构为可维护的模块化结构，在不改变对外行为和 API 的前提下降低复杂度，提升可读性与后续迭代效率。

## Requirements

- 保持 `useClaudeSessions` 的对外导出、返回结构、调用方式不变。
- 仅做结构性重构，不引入产品行为变更。
- 将可独立职责（如类型、常量、纯工具函数、子流程逻辑）拆分到同目录下的子模块中。
- 保持与现有 `src/services/*`、事件常量、状态流转契约兼容。
- 拆分后代码组织应符合 `.trellis/spec/frontend` 中 hooks、目录结构、类型安全与质量规范。

## Acceptance Criteria

- [ ] `src/hooks/useClaudeSessions.ts` 文件体量显著下降，核心入口逻辑可读。
- [ ] 至少完成按职责拆分（如 `types`/`constants`/`utils`/`actions` 或等价结构），并由主 hook 组装。
- [ ] 现有调用方无需改动即可通过 TypeScript 编译。
- [ ] 不新增 lint 错误。
- [ ] 关键静态检查通过（至少 `bunx tsc --noEmit --pretty false`）。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
