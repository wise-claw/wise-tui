# Mission Control 研发驾驶舱（PRD→任务→执行→证据溯源全链路重构）

## Goal

把现有 PRD 拆分向导从分步状态展示器升级为 Mission Control 研发驾驶舱：主视线只保留'需求→任务图谱→执行/证据'三层主叙事；内部工程词汇（cluster/dirty/validation/workflowId 等）降级到详情面板；强调并行编排、依赖锁链与代码/PRD 双向溯源；为后续多 Agent 并发执行预留接口。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
