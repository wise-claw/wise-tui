import type { SessionLinkExportBundle } from "../types/sessionLink";
import type {
  SessionInsightsResult,
  SessionInsightRecommendation,
  SessionRequestRationalityMetrics,
  SessionToolCategory,
} from "./sessionInsights";
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

function formatRecommendationLines(
  r: SessionInsightRecommendation,
  index: number,
): string[] {
  const lines: string[] = [];
  lines.push(
    `### ${index}. [${SEVERITY_LABEL[r.severity]} · ${CATEGORY_LABEL[r.category]}] ${r.title}`,
  );
  lines.push("");
  lines.push(`**描述**：${r.description}`);
  if (r.evidence) lines.push(`**依据**：${r.evidence}`);
  if (r.turnIndex != null) lines.push(`**关联轮次**：${r.turnIndex}`);
  lines.push("");
  return lines;
}

function buildSessionContextLines(
  insights: SessionInsightsResult,
  meta?: {
    repositoryName?: string;
    claudeSessionId?: string | null;
  },
): string[] {
  const { overview } = insights;
  const tokens = overview.tokens;
  const total = tokenTotal(tokens);
  const lines: string[] = ["## 会话概况", ""];
  if (meta?.repositoryName) lines.push(`- **仓库**：${meta.repositoryName}`);
  if (meta?.claudeSessionId) lines.push(`- **Claude Session**：\`${meta.claudeSessionId}\``);
  lines.push(
    `- **轮次 / 耗时**：${overview.turnCount} 轮 · 总 ${formatDurationMs(overview.totalDurationMs)} · 均 ${formatDurationMs(overview.avgTurnDurationMs)}/轮`,
  );
  lines.push(`- **工具调用**：${overview.toolCallCount}`);
  lines.push(
    `- **HTTP 观测/推断**：${overview.httpObservedCount} / ${overview.httpInferredCount}`,
  );
  if (overview.p95HttpLatencyMs != null) {
    lines.push(`- **HTTP P95**：${formatDurationMs(overview.p95HttpLatencyMs)}`);
  }
  if (overview.p95TtftMs != null) {
    lines.push(`- **TTFT P95**：${formatDurationMs(overview.p95TtftMs)}`);
  }
  if (total > 0) {
    lines.push(`- **Token 合计**：${formatTokenCount(total)}`);
    lines.push(`- **Cache 命中率**：${formatCacheHitRate(overview.cacheHitRate)}`);
  }
  lines.push("");
  return lines;
}

const TOOL_CATEGORY_LABEL: Record<SessionToolCategory, string> = {
  builtin: "内置工具",
  mcp: "MCP",
  skill: "Skill",
  subagent: "子代理",
};

export function buildRequestRationalityLines(req: SessionRequestRationalityMetrics): string[] {
  const lines: string[] = ["## 接口与工具链合理性", ""];
  lines.push(
    `- **模型 HTTP 往返**：${req.httpRequestCount} 次（${req.httpRequestsPerTurn.toFixed(1)}/轮）`,
  );
  lines.push(`- **单轮工具峰值**：${req.maxTurnToolCount} 次`);
  if (req.maxTurnTokenTotal != null && req.maxTurnTokenTotal > 0) {
    lines.push(`- **单轮 Token 峰值**：${formatTokenCount(req.maxTurnTokenTotal)}`);
  }
  lines.push("");

  const activeCategories = req.toolCategories.filter((c) => c.count > 0);
  if (activeCategories.length > 0) {
    lines.push("### 工具类别分布", "");
    lines.push("| 类别 | 次数 | 次/轮 | 热点 |");
    lines.push("|------|------|-------|------|");
    for (const c of activeCategories) {
      const hotspot =
        c.topNames.length > 0
          ? c.topNames.map((h) => `${h.name}×${h.count}`).join("、")
          : "—";
      lines.push(
        `| ${TOOL_CATEGORY_LABEL[c.category]} | ${c.count} | ${c.perTurn.toFixed(1)} | ${hotspot} |`,
      );
    }
    lines.push("");
  }

  return lines;
}

function buildSupportingEvidenceLines(insights: SessionInsightsResult): string[] {
  const { slowestTurns, toolHotspots, requestRationality } = insights;
  const lines: string[] = [];
  if (slowestTurns.length === 0 && toolHotspots.length === 0) {
    lines.push(...buildRequestRationalityLines(requestRationality));
    return lines;
  }

  lines.push("## 辅助证据", "");

  if (slowestTurns.length > 0) {
    lines.push("### 耗时 Top 轮次", "");
    lines.push("| 轮次 | 耗时 | 工具 | HTTP | TTFT | Token |");
    lines.push("|------|------|------|------|------|-------|");
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
    lines.push("### 工具热点", "");
    for (const h of toolHotspots) {
      lines.push(`- **${h.name}**：${h.count} 次（轮次 ${h.turns.join(", ")}）`);
    }
    lines.push("");
  }

  lines.push(...buildRequestRationalityLines(requestRationality));

  return lines;
}

const AI_OPTIMIZATION_OUTPUT_INSTRUCTIONS = [
  "输出要求（Markdown，中文）：",
  "1. **问题清单摘要**（按严重程度 P0/P1/P2 排序）",
  "2. **逐条优化方案**（每条含：根因分析、具体步骤、预期收益、注意事项）",
  "3. **接口请求合理性**（MCP/Skill/子代理是否滥用、请求次数与体量、耗时瓶颈、应用层 vs 模型层）",
  "4. **综合优化路径**（可并行 vs 需串行、短期 vs 长期）",
  "5. **验证与度量**（如何确认优化生效，建议观测指标）",
  "",
  "约束：",
  "- 仅基于提供的数据推断，缺失数据处标注「未观测」",
  "- 建议必须可执行，避免空泛",
  "- 不要调用工具或读取仓库文件",
].join("\n");

const SINGLE_AI_OPTIMIZATION_OUTPUT_INSTRUCTIONS = [
  "输出要求（Markdown，中文）：",
  "1. **根因分析**",
  "2. **优化步骤**（具体、可执行）",
  "3. **预期收益**（速度 / Token / 成本）",
  "4. **验证方式**",
  "",
  "约束：",
  "- 仅基于提供的数据推断",
  "- 不要调用工具或读取仓库文件",
].join("\n");

function buildProblemsBodyLines(
  insights: SessionInsightsResult,
  meta?: {
    repositoryName?: string;
    claudeSessionId?: string | null;
  },
  options?: { includeSupportingEvidence?: boolean },
): string[] {
  const { recommendations } = insights;
  const lines: string[] = [
    ...buildSessionContextLines(insights, meta),
    ...(options?.includeSupportingEvidence !== false
      ? buildSupportingEvidenceLines(insights)
      : []),
    `## 检测到的问题（共 ${recommendations.length} 项）`,
    "",
  ];

  if (recommendations.length === 0) {
    lines.push("当前规则引擎未检测到需要优化的问题。");
    lines.push("");
  } else {
    recommendations.forEach((r, i) => {
      lines.push(...formatRecommendationLines(r, i + 1));
    });
  }

  return lines;
}

export type SessionInsightsReportMeta = {
  repositoryName?: string;
  claudeSessionId?: string | null;
  exportedAt?: string;
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

  lines.push(...buildRequestRationalityLines(insights.requestRationality));

  lines.push("## 优化建议");
  lines.push("");
  recommendations.forEach((r, i) => {
    lines.push(...formatRecommendationLines(r, i + 1));
  });

  const cov = overview.dataCoverage;
  lines.push("## 数据覆盖");
  lines.push("");
  lines.push(`- JSONL 用量：${cov.hasJsonlUsage ? "是" : "否"}`);
  lines.push(`- HTTP 响应 usage：${cov.hasHttpUsage ? "是" : "否"}`);
  lines.push(`- HTTP 已观测：${cov.hasObservedHttp ? "是" : "否"}`);
  lines.push(`- LLM 代理：${cov.llmProxyEnabled ? "已开启" : "未开启"}`);
  lines.push(`- FCC trace：${cov.fccTraceCount} 条`);
  lines.push(`- OpenCode Go trace：${cov.opencodeGoProxyTraceCount} 条`);
  lines.push(`- TTFT 明细：${cov.hasTtftData ? "是（LLM 代理）" : "否"}`);
  lines.push("");

  return lines.join("\n");
}

/** 将会话洞察中检测到的全部问题格式化为可复制文本（供外部 AI 优化）。 */
export function buildSessionInsightsProblemsCopyText(
  insights: SessionInsightsResult,
  meta?: Pick<SessionInsightsReportMeta, "repositoryName" | "claudeSessionId">,
): string {
  const lines: string[] = [
    "# Claude Code 会话优化问题清单",
    "",
    ...buildProblemsBodyLines(insights, meta),
    "---",
    "",
    "请针对以上每条问题给出可执行的优化建议，包括：根因分析、具体做法、预期收益（速度/Token/成本）与验证方式。",
  ];

  return lines.join("\n");
}

/** 单条问题的可复制文本（供外部 AI 或分享）。 */
export function buildSessionInsightRecommendationCopyText(
  recommendation: SessionInsightRecommendation,
  insights: SessionInsightsResult,
  meta?: Pick<SessionInsightsReportMeta, "repositoryName" | "claudeSessionId">,
): string {
  const lines: string[] = [
    "# Claude Code 会话优化问题",
    "",
    ...buildSessionContextLines(insights, meta),
    "## 问题详情",
    "",
    ...formatRecommendationLines(recommendation, 1),
    "---",
    "",
    "请针对以上问题给出可执行的优化建议，包括：根因分析、具体做法、预期收益与验证方式。",
  ];
  return lines.join("\n");
}

/** 供主会话 Claude 针对检测问题生成优化方案的 prompt。 */
export function buildSessionInsightsAiOptimizationPrompt(
  insights: SessionInsightsResult,
  meta?: Pick<SessionInsightsReportMeta, "repositoryName" | "claudeSessionId">,
): string {
  const problems = buildSessionInsightsProblemsCopyText(insights, meta);
  return [
    "你是 Claude Code 使用效率与成本优化顾问。以下是从 **会话全链路分析 · 洞察** 中规则引擎检测到的 **全部问题**。",
    "",
    "请针对每条问题给出深度、可执行的优化方案。",
    "",
    AI_OPTIMIZATION_OUTPUT_INSTRUCTIONS,
    "",
    "---",
    "",
    problems,
  ].join("\n");
}

/** 供外部 AI 粘贴的完整优化 Prompt（与主会话 AI 优化等价）。 */
export function buildSessionInsightsExternalAiOptimizationPrompt(
  insights: SessionInsightsResult,
  meta?: Pick<SessionInsightsReportMeta, "repositoryName" | "claudeSessionId">,
): string {
  return buildSessionInsightsAiOptimizationPrompt(insights, meta);
}

/** 供主会话 Claude 针对单条问题生成优化方案。 */
export function buildSessionInsightRecommendationAiPrompt(
  recommendation: SessionInsightRecommendation,
  insights: SessionInsightsResult,
  meta?: Pick<SessionInsightsReportMeta, "repositoryName" | "claudeSessionId">,
): string {
  const problem = buildSessionInsightRecommendationCopyText(recommendation, insights, meta);
  return [
    "你是 Claude Code 使用效率与成本优化顾问。以下是从 **会话全链路分析 · 洞察** 中检测到的 **单条问题**。",
    "",
    "请给出深度、可执行的优化方案。",
    "",
    SINGLE_AI_OPTIMIZATION_OUTPUT_INSTRUCTIONS,
    "",
    "---",
    "",
    problem,
  ].join("\n");
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
    "5. **接口请求合理性**（MCP/Skill 是否必要、调用频次与体量、HTTP 往返、单轮工具链峰值、配置面 overhead）",
    "6. **优先级行动清单**（P0/P1/P2，每条含具体做法）",
    "7. **研究与实验**（可选的 A/B 或度量方式，便于验证优化效果）",
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
