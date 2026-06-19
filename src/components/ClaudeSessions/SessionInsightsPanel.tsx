import { Button, Dropdown, Progress, Space, Tag, Typography, message } from "antd";
import type { MenuProps } from "antd";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { CopyFeedbackIcon } from "../shared/CopyFeedbackIcon";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { save } from "@tauri-apps/plugin-dialog";
import {
  BulbOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  DownOutlined,
  DollarOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { writeTextFileAbsolute } from "../../services/sessionLink";
import type { SessionLinkExportBundle } from "../../types/sessionLink";
import type { SessionInsightsResult, SessionInsightRecommendation, SessionInsightSeverity } from "../../utils/sessionInsights";
import {
  formatCacheHitRate,
  formatDurationMs,
  formatTokenCount,
} from "../../utils/sessionInsights";
import { ClaudeUsageTrendSection } from "./ClaudeUsageTrendSection";
import {
  buildSessionInsightRecommendationAiPrompt,
  buildSessionInsightRecommendationCopyText,
  buildSessionInsightsAiOptimizationPrompt,
  buildSessionInsightsAiPrompt,
  buildSessionInsightsExternalAiOptimizationPrompt,
  buildSessionInsightsMarkdownReport,
  buildSessionInsightsProblemsCopyText,
} from "../../utils/sessionInsightsReport";

const { Text } = Typography;

const SEVERITY_CONFIG: Record<
  SessionInsightSeverity,
  { color: string; icon: ReactNode; label: string }
> = {
  critical: { color: "#ef4444", icon: <WarningOutlined />, label: "严重" },
  warning: { color: "#f59e0b", icon: <WarningOutlined />, label: "警告" },
  info: { color: "#3b82f6", icon: <BulbOutlined />, label: "提示" },
};

const CATEGORY_LABEL: Record<SessionInsightRecommendation["category"], string> = {
  speed: "速度",
  token: "Token",
  tool: "工具",
  observability: "观测",
  reliability: "可靠性",
};

interface Props {
  insights: SessionInsightsResult;
  sessionLabel?: string;
  claudeSessionId?: string | null;
  /** 按需构建元数据链路包（AI 解读时再算，避免抽屉常驻重算）。 */
  resolveLinkMetaBundle?: () => SessionLinkExportBundle | null;
  repositoryPath?: string | null;
  onJumpTurn?: (turnIndex: number) => void;
  onRequestAiAnalysis?: (prompt: string) => void | Promise<void>;
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="app-session-insights__kpi">
      <span className="app-session-insights__kpi-icon" style={{ color: accent }}>
        {icon}
      </span>
      <div className="app-session-insights__kpi-body">
        <span className="app-session-insights__kpi-label">{label}</span>
        <span className="app-session-insights__kpi-value">{value}</span>
        {sub ? <span className="app-session-insights__kpi-sub">{sub}</span> : null}
      </div>
    </div>
  );
}

function RecommendationItem({
  item,
  onJumpTurn,
  onCopy,
  onAiOptimize,
  aiLoading,
}: {
  item: SessionInsightRecommendation;
  onJumpTurn?: (turn: number) => void;
  onCopy?: () => void;
  onAiOptimize?: () => void;
  aiLoading?: boolean;
}) {
  const cfg = SEVERITY_CONFIG[item.severity];
  return (
    <div className={`app-session-insights__rec app-session-insights__rec--${item.severity}`}>
      <span className="app-session-insights__rec-icon" style={{ color: cfg.color }}>
        {cfg.icon}
      </span>
      <div className="app-session-insights__rec-body">
        <div className="app-session-insights__rec-head">
          <Text strong className="app-session-insights__rec-title">
            {item.title}
          </Text>
          <Tag bordered={false} className="app-session-insights__rec-tag">
            {CATEGORY_LABEL[item.category]}
          </Tag>
          {item.turnIndex != null && onJumpTurn ? (
            <button
              type="button"
              className="app-session-insights__rec-jump"
              onClick={() => onJumpTurn(item.turnIndex!)}
            >
              轮次 {item.turnIndex}
            </button>
          ) : null}
        </div>
        <Text type="secondary" className="app-session-insights__rec-desc">
          {item.description}
        </Text>
        {item.evidence ? (
          <Text type="secondary" className="app-session-insights__rec-evidence">
            依据：{item.evidence}
          </Text>
        ) : null}
      </div>
      {onCopy || onAiOptimize ? (
        <div className="app-session-insights__rec-actions">
          {onCopy ? (
            <button
              type="button"
              className="app-session-insights__rec-action"
              title="复制此问题"
              aria-label="复制此问题"
              onClick={onCopy}
            >
              <CopyOutlined />
            </button>
          ) : null}
          {onAiOptimize ? (
            <button
              type="button"
              className="app-session-insights__rec-action app-session-insights__rec-action--ai"
              title="AI 优化此问题"
              aria-label="AI 优化此问题"
              disabled={aiLoading}
              onClick={onAiOptimize}
            >
              <RobotOutlined spin={aiLoading} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const SessionInsightsPanel = memo(function SessionInsightsPanel({
  insights,
  sessionLabel,
  claudeSessionId,
  resolveLinkMetaBundle,
  repositoryPath,
  onJumpTurn,
  onRequestAiAnalysis,
}: Props) {
  const [aiSending, setAiSending] = useState(false);
  const [aiOptimizeSending, setAiOptimizeSending] = useState(false);
  const [singleAiTargetId, setSingleAiTargetId] = useState<string | null>(null);
  const { overview, slowestTurns, toolHotspots, toolLatencyHotspots, duplicateReadPaths, recommendations, baselineComparison, reliability } =
    insights;
  const tokens = overview.tokens;
  const tokenTotal =
    tokens.inputTokens +
    tokens.outputTokens +
    tokens.cacheCreationTokens +
    tokens.cacheReadTokens;

  const reportMeta = useMemo(
    () => ({
      repositoryName: sessionLabel,
      claudeSessionId,
    }),
    [sessionLabel, claudeSessionId],
  );

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, warning: 0, info: 0 };
    for (const r of recommendations) counts[r.severity] += 1;
    return counts;
  }, [recommendations]);

  const tokenSegments = [
    { label: "输入", value: tokens.inputTokens, color: "#6366f1" },
    { label: "输出", value: tokens.outputTokens, color: "#10b981" },
    { label: "缓存写", value: tokens.cacheCreationTokens, color: "#f59e0b" },
    { label: "缓存读", value: tokens.cacheReadTokens, color: "#06b6d4" },
  ].filter((s) => s.value > 0);

  const coverageHints: string[] = [];
  if (!overview.dataCoverage.hasObservedHttp && overview.dataCoverage.hasInferredHttp) {
    coverageHints.push("HTTP 为推断占位");
  }
  if (overview.dataCoverage.llmProxyEnabled) {
    coverageHints.push("LLM 代理已开");
  }
  if (overview.dataCoverage.fccTraceCount > 0) {
    coverageHints.push(`FCC trace ${overview.dataCoverage.fccTraceCount} 条`);
  }
  if (overview.dataCoverage.opencodeGoProxyTraceCount > 0) {
    coverageHints.push(
      `OpenCode trace ${overview.dataCoverage.opencodeGoProxyTraceCount} 条`,
    );
  }
  if (baselineComparison) {
    coverageHints.push(baselineComparison.summary);
  }

  const buildReportMarkdown = useCallback(
    () => buildSessionInsightsMarkdownReport(insights, reportMeta),
    [insights, reportMeta],
  );

  const { copied, copy } = useCopyToClipboard();
  const { copied: problemsCopied, copy: copyProblems } = useCopyToClipboard();
  const { copied: promptCopied, copy: copyPrompt } = useCopyToClipboard();

  const buildProblemsCopyText = useCallback(
    () => buildSessionInsightsProblemsCopyText(insights, reportMeta),
    [insights, reportMeta],
  );

  const buildExternalPrompt = useCallback(
    () => buildSessionInsightsExternalAiOptimizationPrompt(insights, reportMeta),
    [insights, reportMeta],
  );

  const sendAiPrompt = useCallback(
    async (prompt: string, successMessage: string) => {
      if (!onRequestAiAnalysis) {
        message.warning("当前无法向主会话发送分析请求");
        return false;
      }
      try {
        await onRequestAiAnalysis(prompt);
        message.success(successMessage);
        return true;
      } catch (e) {
        message.error(`发送失败：${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
    },
    [onRequestAiAnalysis],
  );

  const handleExportReport = useCallback(async () => {
    const text = buildReportMarkdown();
    const sid = claudeSessionId?.slice(0, 8) ?? "session";
    try {
      const path = await save({
        defaultPath: `session-insights-${sid}-${Date.now()}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFileAbsolute(path, text);
      message.success("洞察报告已导出");
    } catch (e) {
      message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [buildReportMarkdown, claudeSessionId]);

  const handleAiAnalysis = useCallback(async () => {
    setAiSending(true);
    try {
      const prompt = buildSessionInsightsAiPrompt(insights, resolveLinkMetaBundle?.() ?? null);
      await sendAiPrompt(prompt, "已发送 AI 解读请求到主会话");
    } finally {
      setAiSending(false);
    }
  }, [insights, resolveLinkMetaBundle, sendAiPrompt]);

  const handleAiOptimization = useCallback(async () => {
    if (recommendations.length === 0) {
      message.info("当前未检测到需要优化的问题");
      return;
    }
    setAiOptimizeSending(true);
    try {
      const prompt = buildSessionInsightsAiOptimizationPrompt(insights, reportMeta);
      await sendAiPrompt(prompt, "已发送 AI 优化请求到主会话");
    } finally {
      setAiOptimizeSending(false);
    }
  }, [insights, recommendations.length, reportMeta, sendAiPrompt]);

  const handleSingleAiOptimization = useCallback(
    async (recommendation: SessionInsightRecommendation) => {
      setSingleAiTargetId(recommendation.id);
      try {
        const prompt = buildSessionInsightRecommendationAiPrompt(
          recommendation,
          insights,
          reportMeta,
        );
        await sendAiPrompt(prompt, `已发送「${recommendation.title}」的 AI 优化请求`);
      } finally {
        setSingleAiTargetId(null);
      }
    },
    [insights, reportMeta, sendAiPrompt],
  );

  const handleCopySingleRecommendation = useCallback(
    async (recommendation: SessionInsightRecommendation) => {
      const text = buildSessionInsightRecommendationCopyText(recommendation, insights, reportMeta);
      const ok = await copy(text);
      if (ok) message.success("已复制此问题");
    },
    [copy, insights, reportMeta],
  );

  const copyMenuItems = useMemo((): MenuProps["items"] => {
    const disabled = recommendations.length === 0;
    return [
      {
        key: "problems",
        label: "复制问题清单",
        disabled,
      },
      {
        key: "prompt",
        label: "复制完整 Prompt",
        disabled,
      },
    ];
  }, [recommendations.length]);

  const handleCopyMenuClick = useCallback(
    async ({ key }: { key: string }) => {
      if (key === "problems") {
        const ok = await copyProblems(buildProblemsCopyText());
        if (ok) message.success("已复制问题清单");
        return;
      }
      if (key === "prompt") {
        const ok = await copyPrompt(buildExternalPrompt());
        if (ok) message.success("已复制完整 Prompt，可粘贴到外部 AI");
      }
    },
    [buildExternalPrompt, buildProblemsCopyText, copyProblems, copyPrompt],
  );

  return (
    <div className="app-session-insights">
      <div className="app-session-insights__actions">
        <Space size={4} wrap>
          <Button
            size="small"
            icon={<CopyFeedbackIcon copied={copied} />}
            onClick={() => void copy(buildReportMarkdown())}
          >
            {copied ? "已复制" : "复制报告"}
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => void handleExportReport()}>
            导出
          </Button>
          {onRequestAiAnalysis ? (
            <>
              <Button
                size="small"
                icon={<RobotOutlined />}
                loading={aiSending}
                onClick={() => void handleAiAnalysis()}
              >
                AI 解读
              </Button>
              <Button
                size="small"
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={aiOptimizeSending}
                disabled={recommendations.length === 0}
                onClick={() => void handleAiOptimization()}
              >
                AI 优化
              </Button>
            </>
          ) : null}
        </Space>
      </div>

      {coverageHints.length > 0 ? (
        <div className="app-session-insights__coverage">
          {coverageHints.map((hint) => (
            <Tag key={hint} bordered={false} className="app-session-insights__coverage-tag">
              {hint}
            </Tag>
          ))}
        </div>
      ) : null}

      <section className="app-session-insights__section">
        <div className="app-session-insights__kpi-grid">
          <KpiCard
            icon={<ClockCircleOutlined />}
            label="会话耗时"
            value={formatDurationMs(overview.totalDurationMs)}
            sub={`${overview.turnCount} 轮 · 均 ${formatDurationMs(overview.avgTurnDurationMs)}`}
            accent="#3b82f6"
          />
          <KpiCard
            icon={<ThunderboltOutlined />}
            label="HTTP / TTFT"
            value={
              overview.p95TtftMs != null
                ? `TTFT P95 ${formatDurationMs(overview.p95TtftMs)}`
                : overview.p95HttpLatencyMs != null
                  ? `P95 ${formatDurationMs(overview.p95HttpLatencyMs)}`
                  : "—"
            }
            sub={
              [
                overview.p95HttpLatencyMs != null && overview.p95TtftMs != null
                  ? `HTTP P95 ${formatDurationMs(overview.p95HttpLatencyMs)}`
                  : overview.avgHttpLatencyMs != null
                    ? `HTTP 均 ${formatDurationMs(overview.avgHttpLatencyMs)}`
                    : overview.httpObservedCount > 0
                      ? `观测 ${overview.httpObservedCount}`
                      : "未观测",
                overview.avgTtftMs != null ? `TTFT 均 ${formatDurationMs(overview.avgTtftMs)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "需 LLM 代理流式抓包"
            }
            accent="#f97316"
          />
          <KpiCard
            icon={<ToolOutlined />}
            label="工具调用"
            value={String(overview.toolCallCount)}
            sub={`HTTP 推断 ${overview.httpInferredCount}`}
            accent="#a855f7"
          />
          {reliability.toolErrorCount > 0 || reliability.httpErrorCount > 0 ? (
            <KpiCard
              icon={<WarningOutlined />}
              label="可靠性"
              value={`工具错误 ${reliability.toolErrorCount}`}
              sub={`HTTP 错误 ${reliability.httpErrorCount}`}
              accent="#ef4444"
            />
          ) : null}
          <KpiCard
            icon={<DollarOutlined />}
            label="Token / 费用"
            value={tokenTotal > 0 ? formatTokenCount(tokenTotal) : "—"}
            sub={
              [
                overview.contextMetrics
                  ? `上下文 ${overview.contextMetrics.ctxPercent}%`
                  : null,
                overview.cacheHitRate != null ? `Cache ${formatCacheHitRate(overview.cacheHitRate)}` : null,
                tokens.costUsd > 0 ? `$${tokens.costUsd.toFixed(3)}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "暂无用量明细"
            }
            accent="#06b6d4"
          />
        </div>
      </section>

      {tokenTotal > 0 ? (
        <section className="app-session-insights__section">
          <Text className="app-session-insights__section-title">Token 结构</Text>
          <div className="app-session-insights__token-bars">
            {tokenSegments.map((seg) => (
              <div key={seg.label} className="app-session-insights__token-row">
                <span className="app-session-insights__token-label">{seg.label}</span>
                <Progress
                  percent={Math.round((seg.value / tokenTotal) * 100)}
                  strokeColor={seg.color}
                  size="small"
                  showInfo={false}
                />
                <span className="app-session-insights__token-num">{formatTokenCount(seg.value)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {slowestTurns.length > 0 || toolHotspots.length > 0 || toolLatencyHotspots.length > 0 ? (
        <div className="app-session-insights__mid-grid">
          {slowestTurns.length > 0 ? (
            <section className="app-session-insights__section">
              <Text className="app-session-insights__section-title">耗时 Top 轮次</Text>
              <div className="app-session-insights__table">
                <div className="app-session-insights__table-head">
                  <span>轮次</span>
                  <span>耗时</span>
                  <span>工具</span>
                  <span>HTTP</span>
                  <span>TTFT</span>
                  <span>Token</span>
                </div>
                {slowestTurns.map((t) => {
                  const tTotal =
                    t.tokens.inputTokens +
                    t.tokens.outputTokens +
                    t.tokens.cacheCreationTokens +
                    t.tokens.cacheReadTokens;
                  return (
                    <div key={t.turnIndex} className="app-session-insights__table-row">
                      <button
                        type="button"
                        className="app-session-insights__turn-link"
                        onClick={() => onJumpTurn?.(t.turnIndex)}
                      >
                        #{t.turnIndex}
                      </button>
                      <span>{formatDurationMs(t.durationMs)}</span>
                      <span>{t.toolCount}</span>
                      <span>{t.httpObserved > 0 ? formatDurationMs(t.httpLatencyMs) : "—"}</span>
                      <span>{t.ttftMs != null ? formatDurationMs(t.ttftMs) : "—"}</span>
                      <span>{tTotal > 0 ? formatTokenCount(tTotal) : "—"}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {toolHotspots.length > 0 ? (
            <section className="app-session-insights__section">
              <Text className="app-session-insights__section-title">工具热点</Text>
              <div className="app-session-insights__hotspots">
                {toolHotspots.map((h) => (
                  <div key={h.name} className="app-session-insights__hotspot">
                    <Text strong>{h.name}</Text>
                    <Text type="secondary">×{h.count}</Text>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {toolLatencyHotspots.length > 0 ? (
            <section className="app-session-insights__section">
              <Text className="app-session-insights__section-title">慢工具 Top</Text>
              <div className="app-session-insights__table">
                <div className="app-session-insights__table-head">
                  <span>工具</span>
                  <span>P95</span>
                  <span>均耗时</span>
                  <span>次数</span>
                </div>
                {toolLatencyHotspots.map((h) => (
                  <div key={h.name} className="app-session-insights__table-row">
                    <span>{h.name}</span>
                    <span>{formatDurationMs(h.p95DurationMs ?? h.maxDurationMs)}</span>
                    <span>{formatDurationMs(h.avgDurationMs)}</span>
                    <span>{h.count}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {duplicateReadPaths.length > 0 ? (
            <section className="app-session-insights__section">
              <Text className="app-session-insights__section-title">重复 Read</Text>
              <div className="app-session-insights__hotspots">
                {duplicateReadPaths.slice(0, 5).map((d) => (
                  <div key={d.path} className="app-session-insights__hotspot">
                    <Text strong className="app-session-insights__dup-path">
                      {d.path}
                    </Text>
                    <Text type="secondary">×{d.count}</Text>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      <ClaudeUsageTrendSection repositoryPath={repositoryPath} />

      <section className="app-session-insights__section app-session-insights__section--optimize">
        <div className="app-session-insights__section-head">
          <div className="app-session-insights__section-head-main">
            <Text className="app-session-insights__section-title">
              优化建议
              {recommendations.length > 0 ? (
                <Text type="secondary" className="app-session-insights__section-count">
                  {" "}
                  · {recommendations.length} 项
                </Text>
              ) : null}
            </Text>
            {recommendations.length > 0 ? (
              <div className="app-session-insights__severity-tags">
                {(["critical", "warning", "info"] as const).map((severity) =>
                  severityCounts[severity] > 0 ? (
                    <Tag
                      key={severity}
                      bordered={false}
                      className={`app-session-insights__severity-tag app-session-insights__severity-tag--${severity}`}
                    >
                      {SEVERITY_CONFIG[severity].label} {severityCounts[severity]}
                    </Tag>
                  ) : null,
                )}
              </div>
            ) : null}
          </div>
          <Space size={4} wrap className="app-session-insights__section-actions">
            <Dropdown
              menu={{ items: copyMenuItems, onClick: (info) => void handleCopyMenuClick(info) }}
              disabled={recommendations.length === 0}
              trigger={["click"]}
            >
              <Button
                size="small"
                icon={<CopyFeedbackIcon copied={problemsCopied || promptCopied} />}
              >
                复制 <DownOutlined style={{ fontSize: 9, marginInlineStart: 2 }} />
              </Button>
            </Dropdown>
            {onRequestAiAnalysis ? (
              <Button
                size="small"
                type="primary"
                icon={<RobotOutlined />}
                loading={aiOptimizeSending}
                disabled={recommendations.length === 0}
                onClick={() => void handleAiOptimization()}
              >
                AI 优化
              </Button>
            ) : null}
          </Space>
        </div>
        {recommendations.length > 0 ? (
          <Text type="secondary" className="app-session-insights__optimize-hint">
            可将问题复制到外部 AI，或在 Wise 主会话中一键生成优化方案；每条建议也可单独操作。
          </Text>
        ) : null}
        <div className="app-session-insights__rec-list">
          {recommendations.length === 0 ? (
            <Text type="secondary" className="app-session-insights__rec-empty">
              当前未检测到需要优化的问题
            </Text>
          ) : (
            recommendations.map((r) => (
              <RecommendationItem
                key={r.id}
                item={r}
                onJumpTurn={onJumpTurn}
                onCopy={() => void handleCopySingleRecommendation(r)}
                onAiOptimize={
                  onRequestAiAnalysis
                    ? () => void handleSingleAiOptimization(r)
                    : undefined
                }
                aiLoading={singleAiTargetId === r.id}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
});
