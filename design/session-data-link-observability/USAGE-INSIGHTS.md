# AI 使用洞察（Session Usage Insights）

在 **全链路分析** 抽屉内提供第三个视图 **「洞察」**：基于会话链路、JSONL 用量、LLM 代理 / FCC trace，给出速度、Token 效率与可行动优化建议。

## 入口

主会话顶栏 → **全链路分析** → Segmented **洞察**

## 数据源

| 来源 | 用途 |
|------|------|
| `SessionLinkRecord` + `computeSessionLinkTurnMetrics` | 轮次耗时、工具次数、HTTP 观测/推断 |
| `session.jsonl` assistant 行 | Token / 费用（对齐 `claude_code_usage` / ccusage） |
| `ClaudeLlmProxyRecord` | HTTP 延迟、响应体 `usage`、**TTFT**（`ttft_ms` / `first_byte_ms`） |
| `FccTraceEntry` | 直连 FCC 时的延迟与响应摘要 |

**不强制开启 LLM 代理**：无代理时仍可从 JSONL 得到 Token；HTTP 延迟与响应 usage 降级为「未观测」提示。

## 分析引擎

纯函数：`src/utils/sessionInsights.ts` → `computeSessionInsights()`

输出：

- `overview`：总耗时、轮次、工具、HTTP P95、Token 合计、Cache 命中率、数据覆盖
- `turnInsights` / `slowestTurns`：按轮归因
- `toolHotspots`：高频工具
- `recommendations`：规则库生成的优化建议（速度 / Token / 工具 / 观测）

## 优化规则（当前）

0. TTFT P95 ≥ 8s → 首 token 延迟偏高；HTTP P95 − TTFT P95 大 → 流式尾段耗时
1. HTTP 全为推断 → 建议开 LLM 代理或 FCC trace
2. 代理已开无流量 → 提示重启会话
3. Cache 命中率低 + 输入量大 → 稳定 prompt / `/compact`
4. cache_creation 远高于 cache_read → 检查动态前缀
5. 平均每轮工具 ≥ 6 → 缩短工具链
6. 单工具 ≥ 5 次 → 合并探索
7. 单轮耗时 ≥ 60s → 定位瓶颈轮
8. HTTP P95 ≥ 15s → 上游/网络
9. 输出/输入比异常 → 要求简洁输出
10. 无 Token 数据 → 提示落盘 JSONL 或开代理

## UI 组件

`src/components/ClaudeSessions/SessionInsightsPanel.tsx`

- KPI 四宫格：耗时、HTTP、工具、Token/费用
- Token 结构条
- 耗时 Top 轮次表（可跳转链路列表对应轮）
- 工具热点
- 优化建议列表

## 后续扩展（未实现）

- [x] AI 深度解读：将洞察摘要 + 链路元数据发往主会话 Claude
- [x] 导出 / 复制 Markdown 洞察报告
- [x] 跨会话 / 仓库级趋势：洞察页内嵌「仓库用量趋势」+ 顶栏用量 Popover「本仓库」筛选
- [x] 与顶栏 `ClaudeCodeUsagePopover` 互跳（`claudeUsageUiStore`）
- [x] TTFT（流式首 token）从 LLM 代理 SSE 解析（`first_byte_ms` / `ttft_ms`）

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [EXECUTION-PLAN.md](./EXECUTION-PLAN.md) Phase 3
- [LLM-PROXY-ANALYSIS.md](./LLM-PROXY-ANALYSIS.md)
