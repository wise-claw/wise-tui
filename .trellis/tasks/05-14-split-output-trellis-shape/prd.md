# 拆分输出补齐 Trellis 任务结构

## Goal

让 PRD-split wizard 派发 splitter 产出的子任务，能直接形成完整的 Trellis 任务三件套（`prd.md` + `design.md` + `implement.md`）+ jsonl manifests，使每个落盘的子任务**开箱即可 `task.py start` 进 Phase 2**，无需再次手工补 design / implement。

## 当前状态

- `splitterDispatch.ts:259-329` 的 `OUTPUT_SCHEMA_JSON` 只声明 `tasks[] = { id, title, description, role, subtasks, dod, sourceRequirementIds, taskAnchors, ... }`。
- `trellisWriter.writeClusterTasks` 落盘时每个 child 只写 `task.json + prd.md`。
- 子任务进 Phase 2 之前用户仍需手工补 `design.md` + `implement.md`（complex task 要求），与 wizard 的"批量自动化"价值相违。

## Requirements

- R1. splitter prompt 与 schema 扩展：让模型在 split 阶段就分类输出 lightweight（prd-only）/ complex（带 design + implement）。
- R2. trellisWriter 扩展：按分类写入对应文件，文件内容来自 splitter 输出字段。
- R3. Review 阶段 UI：用户可在 Review 改分类 + 改 design/implement 文本。
- R4. 现有"只产 prd.md"的旧 flow 保持向后兼容（schema 升级 + 默认值兜底）。

## Open Questions

- splitter LLM 是否能可靠分类 complex/lightweight？需要 prompt 中给明确判定标准（推荐：subtasks ≥ N 或 dod ≥ M 或角色涉及跨仓 → complex）。
- design.md 由模型直接写还是先列骨架（contracts / data flow / risks）让人填？
- check.jsonl / implement.jsonl 是否也由 splitter 出，还是空文件让 sub-agent 在 Phase 2.1 自治 curate？

## Out of Scope

- 子任务再次自动派发到 trellis-implement（属于 Phase 2，wizard 不负责）。
- 与 Ask 2 的 workflow 编排联动（在 `05-14-project-trellis-spec-workflow` 任务里处理）。

## Notes

- 关联：可能与 `05-14-anchor-smart-paragraph` 撞 schema 变更，建议先做本任务再做锚点改造，避免连续动 OUTPUT_SCHEMA。
