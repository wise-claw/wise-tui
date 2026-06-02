import type { SessionLinkExportBundle } from "../types/sessionLink";
import type { SessionInsightsResult, SessionInsightRecommendation } from "./sessionInsights";
import {
  formatCacheHitRate,
  formatDurationMs,
  formatTokenCount,
} from "./sessionInsights";

const CATEGORY_LABEL: Record<SessionInsightRecommendation["category"], string> = {
  speed: "速度",
  token: "Token",
  tool: "工具",
  observability: "观测",
  reliability: "可靠性",
};

const SEVERITY_LABEL: Record<SessionInsightRecommendation["severity"], string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

function tokenTotal(
  t: SessionInsightsResult["overview"]["tokens"],
): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

/** 将会话洞察渲染为 Markdown 报告（可导出 / 复制）。 */
export function buildSessionInsightsMarkdownReport(
  insights: SessionInsightsResult,
  meta?: {
    repositoryName?: string;
    claudeSessionId?: string | null;
    exportedAt?: string;
  },
): string {
  const { overview, slowestTurns, toolHotspots, recommendations } = insights;
  const tokens = overview.tokens;
  const total = tokenTotal(tokens);
  const lines: string[] = [];

  lines.push("# Claude Code 会话 AI 使用洞察报告");
  lines.push("");
  if (meta?.repositoryName) lines.push(`- **仓库**：${meta.repositoryName}`);
  if (meta?.claudeSessionId) lines.push(`- **Claude Session**：\`${meta.claudeSessionId}\``);
  lines.push(`- **生成时间**：${meta?.exportedAt ?? new Date().toISOString()}`);
  lines.push("");

  lines.push("## 总览");
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("|------|-----|");
  lines.push(`| 会话总耗时 | ${formatDurationMs(overview.totalDurationMs)} |`);
  lines.push(`| 轮次 | ${overview.turnCount}（均 ${formatDurationMs(overview.avgTurnDurationMs)}/轮） |`);
  lines.push(`| 工具调用 | ${overview.toolCallCount} |`);
  lines.push(
    `| HTTP 观测/推断 | ${overview.httpObservedCount} / ${overview.httpInferredCount} |`,
  );
  if (overview.p95HttpLatencyMs != null) {
    lines.push(
      `| HTTP P95 | ${formatDurationMs(overview.p95HttpLatencyMs)} |`,
    );
  }
  if (overview.p95TtftMs != null) {
    lines.push(`| TTFT P95 | ${formatDurationMs(overview.p95TtftMs)} |`);
    if (overview.avgTtftMs != null) {
      lines.push(`| TTFT 均值 | ${formatDurationMs(overview.avgTtftMs)} |`);
    }
  }
  if (total > 0) {
    lines.push(`| Token 合计 | ${formatTokenCount(total)} |`);
    lines.push(`| Cache 命中率 | ${formatCacheHitRate(overview.cacheHitRate)} |`);
    if (tokens.costUsd > 0) lines.push(`| 估算费用 | $${tokens.costUsd.toFixed(4)} |`);
  }
  lines.push("");

  if (total > 0) {
    lines.push("## Token 结构");
    lines.push("");
    lines.push("| 类型 | Token |");
    lines.push("|------|-------|");
    lines.push(`| 输入 | ${formatTokenCount(tokens.inputTokens)} |`);
    lines.push(`| 输出 | ${formatTokenCount(tokens.outputTokens)} |`);
    lines.push(`| 缓存写 | ${formatTokenCount(tokens.cacheCreationTokens)} |`);
    lines.push(`| 缓存读 | ${formatTokenCount(tokens.cacheReadTokens)} |`);
    lines.push("");
  }

  if (slowestTurns.length > 0) {
    lines.push("## 耗时 Top 轮次");
    lines.push("");
    lines.push("| 轮次 | 耗时 | 工具 | HTTP 延迟 | TTFT | Token |");
    lines.push("|------|------|------|-----------|------|-------|");
    for (const t of slowestTurns) {
      const tt =
        t.tokens.inputTokens +
        t.tokens.outputTokens +
        t.tokens.cacheCreationTokens +
        t.tokens.cacheReadTokens;
      lines.push(
        `| ${t.turnIndex} | ${formatDurationMs(t.durationMs)} | ${t.toolCount} | ${t.httpObserved > 0 ? formatDurationMs(t.httpLatencyMs) : "—"} | ${t.ttftMs != null ? formatDurationMs(t.ttftMs) : "—"} | ${tt > 0 ? formatTokenCount(tt) : "—"} |`,
      );
    }
    lines.push("");
  }

  if (toolHotspots.length > 0) {
    lines.push("## 工具热点");
    lines.push("");
    for (const h of toolHotspots) {
      lines.push(`- **${h.name}**：${h.count} 次（轮次 ${h.turns.join(", ")}）`);
    }
    lines.push("");
  }

  lines.push("## 优化建议");
  lines.push("");
  for (const r of recommendations) {
    lines.push(
      `### [${SEVERITY_LABEL[r.severity]} · ${CATEGORY_LABEL[r.category]}] ${r.title}`,
    );
    lines.push("");
    lines.push(r.description);
    if (r.evidence) lines.push("");
    if (r.evidence) lines.push(`> 依据：${r.evidence}`);
    lines.push("");
  }

  const cov = overview.dataCoverage;
  lines.push("## 数据覆盖");
  lines.push("");
  lines.push(`- JSONL 用量：${cov.hasJsonlUsage ? "是" : "否"}`);
  lines.push(`- HTTP 响应 usage：${cov.hasHttpUsage ? "是" : "否"}`);
  lines.push(`- HTTP 已观测：${cov.hasObservedHttp ? "是" : "否"}`);
  lines.push(`- LLM 代理：${cov.llmProxyEnabled ? "已开启" : "未开启"}`);
  lines.push(`- FCC trace：${cov.fccTraceCount} 条`);
  lines.push(`- TTFT 明细：${cov.hasTtftData ? "是（LLM 代理）" : "否"}`);
  lines.push("");

  return lines.join("\n");
}

/** 供主会话 Claude 深度解读的 prompt（结构化摘要 + 可选链路元数据）。 */
export function buildSessionInsightsAiPrompt(
  insights: SessionInsightsResult,
  linkMetaBundle?: SessionLinkExportBundle | null,
): string {
  const report = buildSessionInsightsMarkdownReport(insights);
  const parts: string[] = [
    "你是 Claude Code 使用效率与成本优化顾问。请基于以下 **会话运行洞察** 做深度分析。",
    "",
    "输出要求（Markdown，中文）：",
    "1. **执行摘要**（3–5 条最关键发现）",
    "2. **速度分析**（瓶颈轮次、工具链 vs 模型 HTTP、可量化改进预期）",
    "3. **Token 与成本**（结构解读、Cache 策略、上下文膨胀风险）",
    "4. **工具使用模式**（重复探索、可合并步骤、子代理/Task 建议）",
    "5. **优先级行动清单**（P0/P1/P2，每条含具体做法）",
    "6. **研究与实验**（可选的 A/B 或度量方式，便于验证优化效果）",
    "",
    "约束：",
    "- 仅基于提供的数据推断，缺失数据处明确标注「未观测」",
    "- 建议必须可执行，避免空泛",
    "- 不要调用工具或读取仓库文件",
    "",
    "---",
    "",
    report,
  ];

  if (linkMetaBundle) {
    const compact = {
      exportedAt: linkMetaBundle.exportedAt,
      session: linkMetaBundle.session,
      sources: linkMetaBundle.sources,
      recordSummary: linkMetaBundle.records.slice(0, 120).map((r) => ({
        turnIndex: r.turnIndex,
        layer: r.layer,
        kind: r.kind,
        observed: r.observed,
        summary: r.summary.length > 160 ? `${r.summary.slice(0, 160)}…` : r.summary,
        timestampMs: r.timestampMs,
      })),
      recordCount: linkMetaBundle.records.length,
    };
    parts.push("");
    parts.push("---");
    parts.push("");
    parts.push("## 链路元数据（JSON，供关联分析）");
    parts.push("");
    parts.push("```json");
    parts.push(JSON.stringify(compact, null, 2));
    parts.push("```");
  }

  return parts.join("\n");
}
