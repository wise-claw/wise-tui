import type { ClaudeLlmProxyRecord } from "../services/claudeLlmProxy";
import type { FccTraceEntry } from "../types/fccTrace";
import type { OpencodeGoProxyTraceEntry } from "../types/opencodeGoProxyTrace";
import type { SessionLinkRecord } from "../types/sessionLink";
import { resolveProxyFirstByteMs, resolveProxyRttMs, resolveProxyTtftMs } from "./llmProxyTtft";
import type { SessionLinkTurnMetric } from "./sessionLinkFilters";

export interface TokenUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** 有 usage 字段的 assistant / HTTP 响应条数 */
  sampleCount: number;
}

export type SessionInsightSeverity = "info" | "warning" | "critical";
export type SessionInsightCategory = "speed" | "token" | "tool" | "observability" | "reliability";

export interface SessionInsightRecommendation {
  id: string;
  severity: SessionInsightSeverity;
  category: SessionInsightCategory;
  title: string;
  description: string;
  evidence?: string;
  /** 关联轮次，便于跳转 */
  turnIndex?: number;
}

export interface SessionTurnInsight {
  turnIndex: number;
  durationMs: number;
  toolCount: number;
  httpObserved: number;
  httpLatencyMs: number;
  /** 流式首 token（代理观测，取该轮最小值） */
  ttftMs: number | null;
  firstByteMs: number | null;
  tokens: TokenUsageBreakdown;
}

export interface SessionInsightsDataCoverage {
  hasJsonlUsage: boolean;
  hasHttpUsage: boolean;
  hasObservedHttp: boolean;
  hasInferredHttp: boolean;
  llmProxyEnabled: boolean;
  fccTraceCount: number;
  opencodeGoProxyTraceCount: number;
  hasTtftData: boolean;
}

export interface SessionInsightsOverview {
  totalDurationMs: number;
  turnCount: number;
  toolCallCount: number;
  httpObservedCount: number;
  httpInferredCount: number;
  avgTurnDurationMs: number;
  maxTurnDurationMs: number;
  p95HttpLatencyMs: number | null;
  avgHttpLatencyMs: number | null;
  p95TtftMs: number | null;
  avgTtftMs: number | null;
  p95FirstByteMs: number | null;
  tokens: TokenUsageBreakdown;
  cacheHitRate: number | null;
  dataCoverage: SessionInsightsDataCoverage;
}

export interface SessionToolHotspot {
  name: string;
  count: number;
  turns: number[];
}

export interface SessionInsightsResult {
  overview: SessionInsightsOverview;
  turnInsights: SessionTurnInsight[];
  toolHotspots: SessionToolHotspot[];
  slowestTurns: SessionTurnInsight[];
  recommendations: SessionInsightRecommendation[];
}

export interface ComputeSessionInsightsInput {
  linkRecords: readonly SessionLinkRecord[];
  turnMetrics: readonly SessionLinkTurnMetric[];
  llmProxyRecords?: readonly ClaudeLlmProxyRecord[];
  fccTraces?: readonly FccTraceEntry[];
  opencodeGoProxyTraces?: readonly OpencodeGoProxyTraceEntry[];
  /** 已预过滤的 JSONL usage 行；省略时不再扫描全量 JSONL。 */
  jsonlUsageLines?: readonly string[] | null;
  llmProxyListening?: boolean;
}

const EMPTY_TOKENS: TokenUsageBreakdown = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  sampleCount: 0,
};

function mergeTokenUsage(a: TokenUsageBreakdown, b: TokenUsageBreakdown): TokenUsageBreakdown {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    costUsd: a.costUsd + b.costUsd,
    sampleCount: a.sampleCount + b.sampleCount,
  };
}

function jsonU64(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return 0;
}

/** 单次 JSON.parse：同时提取 usage 与时间戳。 */
export function parseJsonlUsageRow(
  line: string,
): { usage: TokenUsageBreakdown; timestampMs: number | null } | null {
  const trimmed = line.trim();
  if (
    !trimmed ||
    !trimmed.includes("assistant") ||
    !trimmed.includes("input_tokens") ||
    !trimmed.includes("timestamp")
  ) {
    return null;
  }
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (v.type !== "assistant" || v.isApiErrorMessage === true) return null;
  const message = v.message;
  if (!message || typeof message !== "object") return null;
  const usage = (message as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const input = jsonU64(u, "input_tokens");
  if (input === 0 && jsonU64(u, "output_tokens") === 0) return null;

  let costUsd = 0;
  const cost = v.costUSD ?? v.cost_usd;
  if (typeof cost === "number" && Number.isFinite(cost) && cost > 0) {
    costUsd = cost;
  }

  const ts = v.timestamp;
  const timestampMs =
    typeof ts === "string" && Number.isFinite(Date.parse(ts)) ? Date.parse(ts) : null;

  return {
    usage: {
      inputTokens: input,
      outputTokens: jsonU64(u, "output_tokens"),
      cacheCreationTokens: jsonU64(u, "cache_creation_input_tokens"),
      cacheReadTokens: jsonU64(u, "cache_read_input_tokens"),
      costUsd,
      sampleCount: 1,
    },
    timestampMs,
  };
}

/** 从 Claude JSONL assistant 行解析 usage（对齐 claude_code_usage.rs）。 */
export function parseUsageFromJsonlLine(line: string): TokenUsageBreakdown | null {
  return parseJsonlUsageRow(line)?.usage ?? null;
}

/** 从 Anthropic `/v1/messages` 响应 JSON 或 SSE 末块解析 usage。 */
export function parseUsageFromHttpBody(text: string): TokenUsageBreakdown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const tryObject = (raw: string): TokenUsageBreakdown | null => {
    try {
      const v = JSON.parse(raw) as Record<string, unknown>;
      const usage = v.usage;
      if (!usage || typeof usage !== "object") return null;
      const u = usage as Record<string, unknown>;
      const input = jsonU64(u, "input_tokens");
      const output = jsonU64(u, "output_tokens");
      if (input === 0 && output === 0) return null;
      return {
        inputTokens: input,
        outputTokens: output,
        cacheCreationTokens: jsonU64(u, "cache_creation_input_tokens"),
        cacheReadTokens: jsonU64(u, "cache_read_input_tokens"),
        costUsd: 0,
        sampleCount: 1,
      };
    } catch {
      return null;
    }
  };

  const direct = tryObject(trimmed);
  if (direct) return direct;

  // SSE: 取含 usage 的最后一条 data 行
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    const parsed = tryObject(payload);
    if (parsed) return parsed;
  }

  return null;
}

function inferTurnIndexForTimestamp(
  turnMetrics: readonly SessionLinkTurnMetric[],
  ts: number,
): number {
  if (turnMetrics.length === 0) return 1;
  let lo = 0;
  let hi = turnMetrics.length - 1;
  let ans = turnMetrics[0]!.turnIndex;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const row = turnMetrics[mid]!;
    if (row.startMs <= ts) {
      ans = row.turnIndex;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** 预过滤 JSONL：仅保留可能含 assistant usage 的行，避免洞察层扫描 8k 全量。 */
export function filterJsonlLinesForUsageScan(lines: readonly string[] | null | undefined): string[] {
  if (!lines?.length) return [];
  const out: string[] = [];
  for (const line of lines) {
    if (
      line.includes("assistant") &&
      line.includes("input_tokens") &&
      line.includes("timestamp")
    ) {
      out.push(line);
    }
  }
  return out;
}

function cacheHitRate(tokens: TokenUsageBreakdown): number | null {
  const denom = tokens.inputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  if (denom <= 0) return null;
  return tokens.cacheReadTokens / denom;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? null;
}

function extractToolName(record: SessionLinkRecord): string | null {
  if (record.kind !== "tool_use") return null;
  const s = record.summary.trim();
  if (!s) return null;
  const head = s.split("·")[0]?.trim();
  return head || s;
}

function buildRecommendations(input: {
  overview: SessionInsightsOverview;
  turnInsights: SessionTurnInsight[];
  toolHotspots: SessionToolHotspot[];
  llmProxyListening: boolean;
  llmProxyRecordCount: number;
}): SessionInsightRecommendation[] {
  const out: SessionInsightRecommendation[] = [];
  const { overview, turnInsights, toolHotspots } = input;
  const cov = overview.dataCoverage;

  if (cov.hasInferredHttp && !cov.hasObservedHttp) {
    out.push({
      id: "obs-no-http",
      severity: "warning",
      category: "observability",
      title: "模型 HTTP 未直连观测",
      description:
        "当前链路中的 HTTP 节点为推断占位，无法精确分析延迟与 token。建议开启 LLM 代理（上游指向 FCC）或启用 FCC trace。",
      evidence: `推断 HTTP ${overview.httpInferredCount} 条，已观测 0 条`,
    });
  }

  if (input.llmProxyListening && input.llmProxyRecordCount === 0 && cov.hasInferredHttp) {
    out.push({
      id: "obs-proxy-no-traffic",
      severity: "info",
      category: "observability",
      title: "代理已开但无流量",
      description: "LLM 代理监听已开启，但本会话尚无经代理的 HTTP 记录。请新建或重启 Claude 会话后再分析。",
    });
  }

  const rate = overview.cacheHitRate;
  const totalIn = overview.tokens.inputTokens + overview.tokens.cacheCreationTokens + overview.tokens.cacheReadTokens;
  if (rate != null && totalIn > 20_000 && rate < 0.25) {
    out.push({
      id: "token-low-cache",
      severity: "warning",
      category: "token",
      title: "Prompt Cache 命中率偏低",
      description:
        "缓存读占输入侧比例不足 25%。可稳定 system prompt、减少每轮动态前缀，或使用 /compact 压缩上下文。",
      evidence: `命中率 ${(rate * 100).toFixed(1)}%，输入侧合计 ${formatTokenCount(totalIn)} tokens`,
    });
  }

  if (overview.tokens.cacheCreationTokens > overview.tokens.cacheReadTokens * 2 && totalIn > 10_000) {
    out.push({
      id: "token-high-cache-write",
      severity: "info",
      category: "token",
      title: "缓存写入量偏高",
      description:
        "cache_creation 显著高于 cache_read，常见于上下文频繁变动或大段新内容注入。检查是否每轮改写 system 或重复粘贴大文件。",
      evidence: `写 ${formatTokenCount(overview.tokens.cacheCreationTokens)} / 读 ${formatTokenCount(overview.tokens.cacheReadTokens)}`,
    });
  }

  const avgTools =
    overview.turnCount > 0
      ? overview.toolCallCount / overview.turnCount
      : 0;
  if (avgTools >= 6) {
    out.push({
      id: "tool-high-avg",
      severity: "warning",
      category: "tool",
      title: "平均每轮工具调用过多",
      description:
        "工具链偏长会拉长墙钟时间并放大 token 消耗。可合并探索步骤、缩小搜索范围，或使用 Task 子代理拆分任务。",
      evidence: `平均 ${avgTools.toFixed(1)} 次/轮，共 ${overview.toolCallCount} 次`,
    });
  }

  for (const hotspot of toolHotspots) {
    if (hotspot.count >= 5) {
      out.push({
        id: `tool-hotspot-${hotspot.name}`,
        severity: "info",
        category: "tool",
        title: `工具「${hotspot.name}」调用频繁`,
        description: "重复调用同一工具可能表示探索范围过大或缺少中间缓存。考虑一次性读取/搜索或写入 scratchpad。",
        evidence: `${hotspot.count} 次，涉及轮次 ${hotspot.turns.slice(0, 5).join(", ")}${hotspot.turns.length > 5 ? "…" : ""}`,
      });
    }
  }

  const slowTurn = turnInsights.reduce<SessionTurnInsight | null>(
    (best, t) => (!best || t.durationMs > best.durationMs ? t : best),
    null,
  );
  if (slowTurn && slowTurn.durationMs >= 60_000) {
    out.push({
      id: `speed-slow-turn-${slowTurn.turnIndex}`,
      severity: "warning",
      category: "speed",
      title: `轮次 ${slowTurn.turnIndex} 耗时异常`,
      description:
        "单轮超过 1 分钟通常由长工具链或大模型延迟引起。展开该轮时序图定位瓶颈（工具 vs HTTP）。",
      evidence: `耗时 ${formatDurationMs(slowTurn.durationMs)}，工具 ${slowTurn.toolCount} 次`,
      turnIndex: slowTurn.turnIndex,
    });
  }

  if (overview.p95HttpLatencyMs != null && overview.p95HttpLatencyMs >= 15_000) {
    out.push({
      id: "speed-http-p95",
      severity: "warning",
      category: "speed",
      title: "模型 HTTP P95 延迟偏高",
      description: "上游 Provider 或 FCC 转发可能存在瓶颈。检查网络、模型负载，或换用更快模型档位。",
      evidence: `P95 ${formatDurationMs(overview.p95HttpLatencyMs)}，平均 ${overview.avgHttpLatencyMs != null ? formatDurationMs(overview.avgHttpLatencyMs) : "—"}`,
    });
  }

  if (overview.p95TtftMs != null && overview.p95TtftMs >= 8_000) {
    out.push({
      id: "speed-ttft-p95",
      severity: "warning",
      category: "speed",
      title: "首 Token 延迟（TTFT）偏高",
      description:
        "从发起到首个 text/thinking token 的 P95 超过 8 秒。常见原因：大 context、上游排队、冷启动或网络抖动。可尝试 /compact、换模型或检查 FCC/Provider 负载。",
      evidence: `TTFT P95 ${formatDurationMs(overview.p95TtftMs)}${overview.avgTtftMs != null ? `，均 ${formatDurationMs(overview.avgTtftMs)}` : ""}`,
    });
  }

  if (cov.llmProxyEnabled && cov.hasObservedHttp && !cov.hasTtftData) {
    out.push({
      id: "obs-no-ttft",
      severity: "info",
      category: "observability",
      title: "暂无 TTFT 明细",
      description:
        "当前 HTTP 记录缺少首 token 时间戳。请在新版 Wise 下重启 Claude 会话并确保经 LLM 代理转发流式请求。",
    });
  }

  if (overview.p95HttpLatencyMs != null && overview.p95TtftMs != null) {
    const gap = overview.p95HttpLatencyMs - overview.p95TtftMs;
    if (gap >= 10_000 && overview.p95HttpLatencyMs >= 15_000) {
      out.push({
        id: "speed-stream-tail",
        severity: "info",
        category: "speed",
        title: "流式生成尾段耗时较长",
        description:
          "总 HTTP 时间显著高于 TTFT，说明瓶颈在 token 生成阶段而非首 token。可考虑要求简洁输出或降低 max_tokens。",
        evidence: `HTTP P95 ${formatDurationMs(overview.p95HttpLatencyMs)} vs TTFT P95 ${formatDurationMs(overview.p95TtftMs)}`,
      });
    }
  }

  if (overview.tokens.outputTokens > overview.tokens.inputTokens * 3 && overview.tokens.inputTokens > 5000) {
    out.push({
      id: "token-high-output-ratio",
      severity: "info",
      category: "token",
      title: "输出 token 相对输入偏高",
      description: "模型生成长回复较多。若不需要详尽解释，可在 prompt 中要求简洁输出或限制 scope。",
      evidence: `输出 ${formatTokenCount(overview.tokens.outputTokens)} / 输入 ${formatTokenCount(overview.tokens.inputTokens)}`,
    });
  }

  if (!cov.hasJsonlUsage && !cov.hasHttpUsage && overview.turnCount > 0) {
    out.push({
      id: "obs-no-token-data",
      severity: "info",
      category: "observability",
      title: "暂无 token 明细",
      description: "未从 JSONL 或 HTTP 响应解析到 usage。确保会话已落盘 JSONL，或开启 LLM 代理以捕获响应体。",
    });
  }

  if (out.length === 0 && overview.turnCount > 0) {
    out.push({
      id: "all-good",
      severity: "info",
      category: "speed",
      title: "未发现明显优化点",
      description: "当前会话指标在正常范围内。可导出链路包做跨会话对比，或继续观察后续轮次。",
    });
  }

  const severityOrder: Record<SessionInsightSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return out.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.category.localeCompare(b.category),
  );
}

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatCacheHitRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function computeSessionInsights(input: ComputeSessionInsightsInput): SessionInsightsResult {
  const llmProxyRecords = input.llmProxyRecords ?? [];
  const fccTraces = input.fccTraces ?? [];
  const opencodeGoTraces = input.opencodeGoProxyTraces ?? [];
  const jsonlUsageLines = input.jsonlUsageLines ?? [];

  const resolveTurn = (ts: number) => inferTurnIndexForTimestamp(input.turnMetrics, ts);

  const turnTokens = new Map<number, TokenUsageBreakdown>();
  let sessionTokens = { ...EMPTY_TOKENS };
  let hasJsonlUsage = false;
  let hasHttpUsage = false;

  for (const line of jsonlUsageLines) {
    const row = parseJsonlUsageRow(line);
    if (!row) continue;
    hasJsonlUsage = true;
    sessionTokens = mergeTokenUsage(sessionTokens, row.usage);
    const turn = row.timestampMs != null ? resolveTurn(row.timestampMs) : 1;
    const prev = turnTokens.get(turn) ?? { ...EMPTY_TOKENS };
    turnTokens.set(turn, mergeTokenUsage(prev, row.usage));
  }

  const httpLatencies: number[] = [];
  const httpLatencyByTurn = new Map<number, number[]>();
  const ttftLatencies: number[] = [];
  const ttftByTurn = new Map<number, number[]>();
  const firstByteLatencies: number[] = [];

  const addHttpLatency = (turn: number, ms: number) => {
    if (ms <= 0) return;
    httpLatencies.push(ms);
    const list = httpLatencyByTurn.get(turn) ?? [];
    list.push(ms);
    httpLatencyByTurn.set(turn, list);
  };

  for (const rec of input.linkRecords) {
    if (rec.layer !== "http" || !rec.observed) continue;
    const body = rec.detail ?? "";
    const responsePart = body.includes("response:\n") ? body.split("response:\n").pop() ?? body : body;
    const usage = parseUsageFromHttpBody(responsePart);
    if (!usage) continue;
    hasHttpUsage = true;
    sessionTokens = mergeTokenUsage(sessionTokens, usage);
    const prev = turnTokens.get(rec.turnIndex) ?? { ...EMPTY_TOKENS };
    turnTokens.set(rec.turnIndex, mergeTokenUsage(prev, usage));
  }

  for (const rec of llmProxyRecords) {
    const turn = resolveTurn(rec.timestampMs);
    addHttpLatency(turn, rec.durationMs);
    const ttft = resolveProxyTtftMs(rec);
    if (ttft != null) {
      ttftLatencies.push(ttft);
      const list = ttftByTurn.get(turn) ?? [];
      list.push(ttft);
      ttftByTurn.set(turn, list);
    }
    const fb = resolveProxyFirstByteMs(rec);
    const rtt = resolveProxyRttMs(rec);
    if (rtt != null) {
      firstByteLatencies.push(rtt);
    } else if (fb != null) {
      firstByteLatencies.push(fb);
    }
    const usage = parseUsageFromHttpBody(rec.responseBodyPreview);
    if (usage) {
      hasHttpUsage = true;
      sessionTokens = mergeTokenUsage(sessionTokens, usage);
      const prev = turnTokens.get(turn) ?? { ...EMPTY_TOKENS };
      turnTokens.set(turn, mergeTokenUsage(prev, usage));
    }
  }

  for (const trace of fccTraces) {
    if (trace.durationMs == null || trace.durationMs <= 0) continue;
    const turn = resolveTurn(trace.timestampMs);
    addHttpLatency(turn, trace.durationMs);
    const usage = parseUsageFromHttpBody(trace.responsePreview ?? "");
    if (usage) {
      hasHttpUsage = true;
      sessionTokens = mergeTokenUsage(sessionTokens, usage);
      const prev = turnTokens.get(turn) ?? { ...EMPTY_TOKENS };
      turnTokens.set(turn, mergeTokenUsage(prev, usage));
    }
  }

  for (const trace of opencodeGoTraces) {
    if (trace.durationMs <= 0) continue;
    const turn = resolveTurn(trace.timestampMs);
    addHttpLatency(turn, trace.durationMs);
    const usage = parseUsageFromHttpBody(trace.responsePreview ?? "");
    if (usage) {
      hasHttpUsage = true;
      sessionTokens = mergeTokenUsage(sessionTokens, usage);
      const prev = turnTokens.get(turn) ?? { ...EMPTY_TOKENS };
      turnTokens.set(turn, mergeTokenUsage(prev, usage));
    }
  }

  let httpObservedCount = 0;
  let httpInferredCount = 0;
  let toolCallCount = 0;
  for (const r of input.linkRecords) {
    if (r.kind === "tool_use") toolCallCount += 1;
    if (r.layer !== "http") continue;
    if (r.observed) httpObservedCount += 1;
    else httpInferredCount += 1;
  }

  const turnInsights: SessionTurnInsight[] = input.turnMetrics.map((m) => {
    const latencies = httpLatencyByTurn.get(m.turnIndex) ?? [];
    const httpLatencyMs = latencies.reduce((a, b) => a + b, 0);
    const turnTtfts = ttftByTurn.get(m.turnIndex) ?? [];
    const ttftMs = turnTtfts.length > 0 ? Math.min(...turnTtfts) : null;
    return {
      turnIndex: m.turnIndex,
      durationMs: m.durationMs,
      toolCount: m.toolCount,
      httpObserved: m.httpObserved,
      httpLatencyMs,
      ttftMs,
      firstByteMs: null,
      tokens: turnTokens.get(m.turnIndex) ?? { ...EMPTY_TOKENS },
    };
  });

  const totalDurationMs = turnInsights.reduce((a, t) => a + t.durationMs, 0);
  const turnCount = input.turnMetrics.length;
  const maxTurnDurationMs = turnInsights.reduce((m, t) => Math.max(m, t.durationMs), 0);

  const toolMap = new Map<string, { count: number; turns: Set<number> }>();
  for (const r of input.linkRecords) {
    const name = extractToolName(r);
    if (!name) continue;
    const entry = toolMap.get(name) ?? { count: 0, turns: new Set<number>() };
    entry.count += 1;
    entry.turns.add(r.turnIndex);
    toolMap.set(name, entry);
  }
  const toolHotspots: SessionToolHotspot[] = [...toolMap.entries()]
    .map(([name, { count, turns }]) => ({
      name,
      count,
      turns: [...turns].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const overview: SessionInsightsOverview = {
    totalDurationMs,
    turnCount,
    toolCallCount,
    httpObservedCount,
    httpInferredCount,
    avgTurnDurationMs: turnCount > 0 ? totalDurationMs / turnCount : 0,
    maxTurnDurationMs,
    p95HttpLatencyMs: percentile(httpLatencies, 95),
    avgHttpLatencyMs:
      httpLatencies.length > 0
        ? httpLatencies.reduce((a, b) => a + b, 0) / httpLatencies.length
        : null,
    p95TtftMs: percentile(ttftLatencies, 95),
    avgTtftMs:
      ttftLatencies.length > 0
        ? ttftLatencies.reduce((a, b) => a + b, 0) / ttftLatencies.length
        : null,
    p95FirstByteMs: percentile(firstByteLatencies, 95),
    tokens: sessionTokens,
    cacheHitRate: cacheHitRate(sessionTokens),
    dataCoverage: {
      hasJsonlUsage,
      hasHttpUsage,
      hasObservedHttp: httpObservedCount > 0,
      hasInferredHttp: httpInferredCount > 0,
      llmProxyEnabled: Boolean(input.llmProxyListening),
      fccTraceCount: fccTraces.length,
      opencodeGoProxyTraceCount: opencodeGoTraces.length,
      hasTtftData: ttftLatencies.length > 0,
    },
  };

  const slowestTurns = [...turnInsights].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

  const recommendations = buildRecommendations({
    overview,
    turnInsights,
    toolHotspots,
    llmProxyListening: Boolean(input.llmProxyListening),
    llmProxyRecordCount: llmProxyRecords.length,
  });

  return {
    overview,
    turnInsights,
    toolHotspots,
    slowestTurns,
    recommendations,
  };
}
