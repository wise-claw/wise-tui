# Wise 全链路分析 — 序列图 / 洞察 按轮次过滤 — 实施计划

参见 `.omc/autopilot/spec.md`。

## 任务列表（按依赖顺序）

### T1 — 工具函数：序列事件按轮次区间过滤
**文件**：
- 改 `src/utils/claudeSessionTrajectorySequence.ts`
- 新建 `src/utils/claudeSessionTrajectorySequence.turnRange.test.ts`（小聚焦测试，不动现有大测试文件）

**API**：
```ts
export function filterSequenceEventsForTurnRange(
  events: readonly SequenceEvent[],
  fromTurn: number,
  toTurn: number,
): SequenceEvent[];
```

**实现**：
- `if (toTurn < fromTurn || toTurn < 1) return [];`
- 重用 `sequenceEventTurnIndex(ev, counter)`，filter 出 `idx >= fromTurn && idx <= toTurn`。
- 单轮场景退化等价于 `filterSequenceEventsForTurn(events, n)`（用 `n,n` 调用即可）。

**测试**：构造若干 `user_input` + `tool_call` 混合事件，验证：
- 全区间 = 全量；
- 单轮 (3,3) = 第 3 轮事件；
- 多轮 (2,4) = 含 2/3/4 轮事件；
- 越界返回空。

---

### T2 — 工具函数：linkRecords / turnMetrics 按轮次区间过滤
**文件**：
- 改 `src/utils/sessionLinkFilters.ts`
- 改 `src/utils/sessionLinkFilters.test.ts`（追加 describe 块；若无此文件，新建 `sessionLinkFilters.turnRange.test.ts`）

**API**：
```ts
export interface TurnRange {
  fromTurn: number;
  toTurn: number;
}

export function filterSessionLinkRecordsByTurnRange(
  records: readonly SessionLinkRecord[],
  range: TurnRange | null,
): SessionLinkRecord[];

export function filterTurnMetricsByTurnRange(
  metrics: readonly SessionLinkTurnMetric[],
  range: TurnRange | null,
): SessionLinkTurnMetric[];

export function deriveTimestampRangeFromTurnMetrics(
  metrics: readonly SessionLinkTurnMetric[],
  range: TurnRange | null,
): { startMs: number; endMs: number } | null;
```

**语义**：`range == null` 直通；`fromTurn > toTurn` → 空数组；时间戳区间用 `metrics` 中 `turnIndex ∈ [fromTurn,toTurn]` 的 `min(startMs)`、`max(endMs)`，没有则返回 null。

**测试**：
- null → 原数组；
- 区间内 / 越界 / 倒置；
- timestampRange 的最小 / 最大值取自匹配的 metrics。

---

### T3 — Drawer 集成：状态、UI、过滤接线
**改文件**：
- `src/components/ClaudeSessions/SessionDataLinkDrawer.tsx`

**改动概要**：

1. **新 state**：`const [turnRange, setTurnRange] = useState<TurnRange | null>(null);`（local，关抽屉时不需保留 — 在 `useEffect(open=false)` 里 reset，与现有 `setActiveTurnKeys([])` 同一处加 `setTurnRange(null)`）。

2. **派生数据**（`useMemo`）：
   ```ts
   const diagramEvents = useMemo(
     () => turnRange == null
       ? events
       : filterSequenceEventsForTurnRange(events, turnRange.fromTurn, turnRange.toTurn),
     [events, turnRange],
   );

   const insightsLinkRecords = useMemo(
     () => filterSessionLinkRecordsByTurnRange(linkRecords, turnRange),
     [linkRecords, turnRange],
   );
   const insightsTurnMetrics = useMemo(
     () => filterTurnMetricsByTurnRange(turnMetrics, turnRange),
     [turnMetrics, turnRange],
   );
   const insightsTimestampRange = useMemo(
     () => deriveTimestampRangeFromTurnMetrics(turnMetrics, turnRange),
     [turnMetrics, turnRange],
   );
   const filterByTimestampRange = useCallback(
     <T extends { timestampMs: number }>(rows: readonly T[] | undefined) => {
       if (!rows) return rows;
       if (!insightsTimestampRange) return rows;
       const { startMs, endMs } = insightsTimestampRange;
       return rows.filter((r) => r.timestampMs >= startMs && r.timestampMs <= endMs);
     },
     [insightsTimestampRange],
   );
   ```
   - JSONL usage 行用 `parseJsonlUsageRow` 取 `timestampMs` 后再过滤，封装为 `filterJsonlUsageLinesByTimestampRange(lines, range)`，放在 `sessionInsights.ts` 末尾以避免循环依赖。

3. **修改 `sessionInsights` useMemo**：从 `linkRecords / turnMetrics / llmProxyRecords / fccTraces / opencodeGoProxyTraces / jsonlUsageLines` 全部换成区间过滤后版本。

4. **新 UI 控件**（`viewMode !== "list"` 时显示，与现有 `filterPreset Select` 同一行）：
   ```tsx
   {viewMode !== "list" && (
     <TurnRangeFilter
       turnMetrics={turnMetrics}
       value={turnRange}
       onChange={setTurnRange}
     />
   )}
   ```
   - 把 `<TurnRangeFilter>` 写在同一文件里（小内部组件，避免新文件）：
     - `<Select>`：`"all"` / `:K`（每轮）/ `__range`（自定义）；
     - `__range` 选中弹 `<Popover>`，内含两个 `<Select>` (起 / 止) + 「确定 / 重置」按钮；
     - 显示 label 例：「全部 12 轮」、「第 5 轮」、「3 ~ 7 轮」。

5. **`handleJumpTurnFromInsights`** 中追加 `setTurnRange(null);`（避免列表跳转后筛掉目标轮次）。

6. **保留 `filteredRecords` / 列表 / 导出 bundle 不变**（spec 要求）。

**渲染替换**：
- `<ClaudeSessionSequenceDiagram events={events} markInferredHttp />` → `events={diagramEvents}`。
- 关抽屉 reset：在已存在的 `useEffect(open)` 内，`open === false` 分支 push `setTurnRange(null)`。

---

### T4 — 验证（QA）
1. `bunx tsc --noEmit 2>&1 | tail -30` → exit=0。
2. `bun test src/utils/claudeSessionTrajectorySequence.turnRange.test.ts src/utils/sessionLinkFilters.test.ts` → 通过。
3. `bun test` 全量回归 → 现有用例不受影响。

> 严格遵守项目规则：不启动 dev/build/start/serve，仅 `tsc --noEmit` + `bun test`。

---

## 依赖图

```
T1 ── T3 ── T4
T2 ──┘
```

## 风险与回退

- **轮次划分一致性**：`SessionLinkRecord.turnIndex`（来自 `buildSessionLinkRecords`）与 `sequenceEventTurnIndex`（来自 `claudeSessionTrajectorySequence`）必须同源 — 都按 `user_input` 计数，已验证一致。
- **proxy/trace 时间戳过滤**：单轮区间在极端边界（同毫秒并发）可能导致少计 1 条；接受此误差，spec 明确 `[startMs, endMs]` 闭区间。
- **多 useMemo 增加渲染压力**：Drawer 已经有较多 memo，新增 4 个轻量过滤的成本可忽略；turnRange 不变时不重算。
- **回退**：T1/T2 是新增导出，不影响旧用法；T3 全局 prop 名替换可在不接新 UI 时只暴露 `<TurnRangeFilter>`，回退易（删 5 行 useMemo + 替换回 `events` 即可）。
