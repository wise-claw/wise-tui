# 全链路分析 — 序列图 / 洞察 按轮次过滤

## 用户意图

在 `SessionDataLinkDrawer`（全链路分析抽屉）的「序列图」和「洞察」两个视图，新增按轮次（turn / 轮次）过滤的能力。当前仅「链路列表」支持按事件类型过滤，「序列图」始终展示全部 events、「洞察」始终基于全会话聚合，缺乏对具体一轮或一段连续轮次的聚焦。

## 范围

### In-Scope

1. **新增「轮次过滤器」UI**：在 `SessionDataLinkDrawer` 顶部工具栏，与现有 `filterPreset Select` 并列，仅在 `viewMode === "diagram"` 或 `viewMode === "insights"` 时可见。
2. **轮次范围模型**：选择「全部 / 单轮 / 连续区间 [from..to]」三态；落地为 `{ from: number; to: number } | null`（`null` 表示全部）。
3. **序列图按轮次过滤**：现有 `<ClaudeSessionSequenceDiagram events={events} />` 切换为按轮次过滤后的事件子集。
4. **洞察按轮次过滤**：调用 `computeSessionInsights` 之前，按轮次区间过滤 `linkRecords` / `turnMetrics` / `llmProxyRecords` / `fccTraces` / `opencodeGoProxyTraces` / `jsonlUsageLines`，使所有 KPI、最慢轮次表、工具热点、建议都基于选定区间重新计算。
5. **新增工具函数 + 单元测试**：
   - `filterSequenceEventsForTurnRange(events, fromTurn, toTurn)` 在 `claudeSessionTrajectorySequence.ts`；
   - `filterSessionLinkRecordsByTurnRange(records, range)`、`filterTurnMetricsByTurnRange(metrics, range)` 在 `sessionLinkFilters.ts`；
   - `filterRecordsByTimestampRange` 通用按时间戳区间过滤 trace/proxy/jsonl 行（在 `src/utils/sessionInsights.ts` 旁就近放或新建小工具文件）。

### Out-of-Scope

- 跨会话的过滤、保存历史筛选偏好（不进 `claudeUsageUiStore`）。
- 「列表」视图按轮次过滤（当前列表已经按轮次分组展开，且每轮已有「时序图」按钮，无需冗余增加）。
- 修改 `SessionInsightsPanel` 内部布局（仅传入过滤后的 insights）。
- 后端命令调整、Tauri 权限调整。

## 用户故事

1. 用户在序列图视图，选择「单轮 = 第 5 轮」，序列图只渲染该轮的事件。
2. 用户在洞察视图，选择「区间 = 第 3 ~ 第 7 轮」，KPI、Token 条、最慢轮次、工具热点全部基于这 5 轮重算。
3. 切换 viewMode 在 `list` ↔ `diagram` ↔ `insights` 之间不会重置选择（保留筛选）；关闭抽屉后状态丢弃，重新打开恢复「全部」。

## UI 设计

工具栏（位于 viewMode `Segmented` 下方现有 filterPreset 行）：

```
[Segmented: 链路列表 | 序列图 | 洞察]
[原 filterPreset Select (仅 list 显示)] [轮次过滤 (仅 diagram/insights 显示)]
```

「轮次过滤」控件用 Ant Design `Select` + `value="all"` / `value=":N"`（单轮）/ `value="A:B"` 三种模式：

- 选项构造：
  - 第 1 项 `{ label: "全部 (N 轮)", value: "all" }`；
  - 然后逐轮 `{ label: "第 K 轮", value: ":K" }`；
  - 末项 `{ label: "自定义区间…", value: "__range" }`，选中时弹出小型区间选择（双 `Select` 组合：起始轮 / 结束轮，自动校正 from <= to）。

控件宽度 ~180px，与 `filterPreset Select` 风格一致。

## 数据流

```
linkPipeline ──┬─► linkRecords ─► filterSessionLinkRecordsByTurnRange ─► insightsLinkRecords
               │                                                       └► filteredRecords (现有 list 视图，仍走 filterPreset)
               └─► events ─► filterSequenceEventsForTurnRange ─► diagramEvents

turnMetrics ─► filterTurnMetricsByTurnRange ─► insightsTurnMetrics
llmProxyRecords / fccTraces / opencodeGoProxyTraces ─► filterRecordsByTimestampRange(turnMetricsByRange) ─► …
jsonlUsageLines ─► filterJsonlLinesByTimestampRange ─► …
```

时间戳区间从 `turnMetrics` 在区间内的最小 `startMs`、最大 `endMs` 推导；若区间在 turnMetrics 中没有命中（极端情况），返回空。

## 验收

- `viewMode === "diagram"` 选中第 N 轮时，`<ClaudeSessionSequenceDiagram>` 只渲染该轮事件（与已有「时序图」per-turn 模态结果一致）。
- `viewMode === "insights"` 选中区间时，`SessionInsightsPanel` 显示的 KPI 数值与该区间手工累加结果一致；slowestTurns、toolHotspots、recommendations 均基于过滤后数据。
- 切回 `viewMode === "list"` 不报错；筛选保留。
- `bunx tsc --noEmit` 通过；新增工具单测通过。
- 不破坏现有「时序图」per-turn 模态、列表过滤、导出 bundle 行为（导出仍按 `filterPreset` 处理 list；轮次过滤不影响导出）。

## 风险

- `events` 与 `linkRecords` 的轮次划分都用 `user_input` 累加器，已经一致；只要重用现有的 `sequenceEventTurnIndex` 与 `SessionLinkRecord.turnIndex`，过滤结果天然对齐。
- LLM proxy / fcc / opencode-go 的 trace 没有 `turnIndex`，必须用 timestamp + turnMetrics 推断，复用 `inferTurnIndexForTimestamp` 思路；用区间的 `[startMs, endMs]` 截取即可。
- 洞察组件 `SessionInsightsPanel` 接受 `onJumpTurn` 跳列表的 callback，跳转目标轮次需要在过滤区间外仍然可达 → `handleJumpTurnFromInsights` 在切回 list 时把轮次范围 reset 为「全部」。
