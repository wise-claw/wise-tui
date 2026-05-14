# 锚点智能段落

## Goal

在 bc4408c 的"选段→锚点"基础上加 markdown 语义感知：选段自动 snap 到段落 / 列表项 / heading 边界，并支持基于 source requirement 的自动预填。

## 当前状态

- bc4408c 已实现：
  - `captureSelectionOffset` 把浏览器 selection 换算成 `prdMarkdown` 偏移
  - `deriveAnchorFromRange` 写入 textHash + 上下文
  - `shiftAnchorEdge` 离散微调（默认步长 10c）
- 缺：完全不感知 markdown 结构。用户选半个 paragraph 也照写。

## Requirements

- R1. snap 到结构边界：选段时根据 markdown AST 把 from / to 自动扩到所在 paragraph（或 list item / heading）的完整边界，可开关。
- R2. 自动建议锚点：派发完成后，对每条子任务用其 `sourceRequirementIds` 在 PRD 的源段范围预填 anchor（覆盖 splitter 给的可能不准的 anchor）。
- R3. hover 反馈：hover requirement Tag 时高亮其在 PRD 视图的源段（与锚点高亮共用一个 layer）。
- R4. 三种锚点来源在 UI 上可区分：splitter / 手工选段 / 智能段落 snap / 自动预填。

## Open Questions

- markdown AST 链路用哪个？Milkdown 内部用 remark，能否复用？还是引入独立 `unified` 链。
- snap 默认开还是关？默认关可能教学成本低。
- hover 高亮性能：实时计算 paragraph 边界 vs 预算缓存。

## Out of Scope

- 跨段 anchor（一个 task 锚到多个不连续段落）。
- 锚点的可视化拖拽编辑（已确认舍弃方案 B）。

## Notes

- 强依赖：`05-14-prd-input-richtext`（共享 markdown AST 链）；不强求严格顺序，但同时开两个会撞 lib 选型。
- 与 `05-14-split-output-trellis-shape` 关联：自动预填的 anchor 写入 schema 时可能要新增字段标注 source（splitter vs auto）。
