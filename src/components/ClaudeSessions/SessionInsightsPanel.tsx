import { Button, Progress, Space, Tag, Typography, message } from "antd";
import type { ReactNode } from "react";
import { memo, useCallback, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  BulbOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
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
  buildSessionInsightsAiPrompt,
  buildSessionInsightsMarkdownReport,
} from "../../utils/sessionInsightsReport";

const { Text } = Typography;

const SEVERITY_CONFIG: Record<
  SessionInsightSeverity,
  { color: string; icon: ReactNode }
> = {
  critical: { color: "#ef4444", icon: <WarningOutlined /> },
  warning: { color: "#f59e0b", icon: <WarningOutlined /> },
  info: { color: "#3b82f6", icon: <BulbOutlined /> },
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
}: {
  item: SessionInsightRecommendation;
  onJumpTurn?: (turn: number) => void;
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
  const { overview, slowestTurns, toolHotspots, recommendations } = insights;
  const tokens = overview.tokens;
  const tokenTotal =
    tokens.inputTokens +
    tokens.outputTokens +
    tokens.cacheCreationTokens +
    tokens.cacheReadTokens;

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

  const buildReportMarkdown = useCallback(
    () =>
      buildSessionInsightsMarkdownReport(insights, {
        repositoryName: sessionLabel,
        claudeSessionId,
      }),
    [insights, sessionLabel, claudeSessionId],
  );

  const handleCopyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildReportMarkdown());
    } catch {
      message.error("复制失败");
    }
  }, [buildReportMarkdown]);

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
    } catch (e) {
      message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [buildReportMarkdown, claudeSessionId]);

  const handleAiAnalysis = useCallback(async () => {
    if (!onRequestAiAnalysis) {
      message.warning("当前无法向主会话发送分析请求");
      return;
    }
    setAiSending(true);
    try {
      const prompt = buildSessionInsightsAiPrompt(insights, resolveLinkMetaBundle?.() ?? null);
      await onRequestAiAnalysis(prompt);
    } catch (e) {
      message.error(`发送失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiSending(false);
    }
  }, [insights, resolveLinkMetaBundle, onRequestAiAnalysis]);

  return (
    <div className="app-session-insights">
      <div className="app-session-insights__actions">
        <Space size={4} wrap>
          <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopyReport()}>
            复制
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => void handleExportReport()}>
            导出
          </Button>
          {onRequestAiAnalysis ? (
            <Button
              size="small"
              type="primary"
              icon={<RobotOutlined />}
              loading={aiSending}
              onClick={() => void handleAiAnalysis()}
            >
              AI 解读
            </Button>
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
          <KpiCard
            icon={<DollarOutlined />}
            label="Token / 费用"
            value={tokenTotal > 0 ? formatTokenCount(tokenTotal) : "—"}
            sub={
              [
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

      {slowestTurns.length > 0 || toolHotspots.length > 0 ? (
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
        </div>
      ) : null}

      <ClaudeUsageTrendSection repositoryPath={repositoryPath} />

      <section className="app-session-insights__section">
        <Text className="app-session-insights__section-title">优化建议</Text>
        <div className="app-session-insights__rec-list">
          {recommendations.map((r) => (
            <RecommendationItem key={r.id} item={r} onJumpTurn={onJumpTurn} />
          ))}
        </div>
      </section>
    </div>
  );
});
