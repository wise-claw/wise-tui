import { Button, Progress, Space, Tag, Typography, message } from "antd";
import { memo, useCallback, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ApiOutlined,
  DownloadOutlined,
  DownOutlined,
  HistoryOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SaveOutlined,
  SyncOutlined,
  UpOutlined,
} from "@ant-design/icons";
import type { UseSessionFeedbackLoopResult } from "../../hooks/useSessionFeedbackLoop";
import { SessionFeedbackConfigPatchPanel } from "./SessionFeedbackConfigPatchPanel";
import { writeTextFileAbsolute } from "../../services/sessionLink";
import {
  buildFeedbackLoopTrend,
  formatComparisonMarkdown,
  type FeedbackLoopPhase,
  type SessionFeedbackCycle,
} from "../../utils/sessionFeedbackLoop";

const { Text } = Typography;

const PHASE_LABEL: Record<FeedbackLoopPhase, string> = {
  idle: "待命",
  running: "启动中",
  awaiting_turns: "等待新轮次",
  comparing: "比对中",
  completed: "已完成",
  stopped: "已停止",
};

const COMPLETION_LABEL = {
  max_cycles: "已达上限",
  converged: "已收敛",
  manual: "手动停止",
} as const;

import type { FeedbackLoopDispatchKind } from "../../utils/sessionFeedbackLoopDispatch";

interface Props {
  loop: UseSessionFeedbackLoopResult;
  featureEnabled: boolean;
  injectHabitsToSystemPrompt?: boolean;
  optimizeConfigArtifacts?: boolean;
  onDispatchSessionFeedbackLoop?: (
    prompt: string,
    kind: FeedbackLoopDispatchKind,
    cycleIndex?: number,
  ) => void | Promise<void>;
}

function scoreToPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(100, 50 + score / 2)));
}

function TrendChart({ cycles }: { cycles: readonly SessionFeedbackCycle[] }) {
  const points = useMemo(() => buildFeedbackLoopTrend(cycles), [cycles]);
  if (points.length === 0) return null;

  return (
    <div className="app-session-feedback-loop__trend">
      <Text type="secondary" className="app-session-feedback-loop__trend-title">
        得分趋势
      </Text>
      <div className="app-session-feedback-loop__trend-grid">
        {points.map((p) => (
          <div key={p.cycleIndex} className="app-session-feedback-loop__trend-col">
            <span className="app-session-feedback-loop__trend-label">#{p.cycleIndex}</span>
            <Progress
              type="circle"
              percent={scoreToPercent(p.overallScore)}
              size={44}
              strokeColor={p.improved ? "#10b981" : "#94a3b8"}
              format={() => p.overallScore.toFixed(0)}
            />
            <span className="app-session-feedback-loop__trend-sub">
              {p.speedScore.toFixed(0)}/{p.efficiencyScore.toFixed(0)}/{p.qualityScore.toFixed(0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CycleCard({ cycle }: { cycle: SessionFeedbackCycle }) {
  const [expanded, setExpanded] = useState(false);
  const comparison = cycle.comparison;

  if (!comparison) {
    return (
      <div className="app-session-feedback-loop__cycle app-session-feedback-loop__cycle--pending">
        <Text strong>循环 {cycle.cycleIndex}</Text>
        <Text type="secondary"> · 等待优化后新轮次…</Text>
      </div>
    );
  }

  const scoreColor =
    comparison.overallScore > 5 ? "#10b981" : comparison.overallScore < -5 ? "#ef4444" : "#64748b";

  return (
    <div className="app-session-feedback-loop__cycle">
      <div className="app-session-feedback-loop__cycle-head">
        <Text strong>循环 {cycle.cycleIndex}</Text>
        <Tag bordered={false} color={comparison.improved ? "success" : "default"}>
          {comparison.summary}
        </Tag>
        <Text style={{ color: scoreColor }}>{comparison.overallScore.toFixed(1)}</Text>
        {cycle.after?.scopedTurnCount != null ? (
          <Tag bordered={false} className="app-session-feedback-loop__scope-tag">
            增量 {cycle.after.scopedTurnFrom}–{cycle.after.scopedTurnTo} 轮
          </Tag>
        ) : null}
        <button
          type="button"
          className="app-session-feedback-loop__expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <UpOutlined /> : <DownOutlined />}
        </button>
      </div>
      <div className="app-session-feedback-loop__scores">
        <div className="app-session-feedback-loop__score-row">
          <span>速度</span>
          <Progress
            percent={scoreToPercent(comparison.speedScore)}
            size="small"
            showInfo={false}
            strokeColor="#3b82f6"
          />
          <span>{comparison.speedScore.toFixed(0)}</span>
        </div>
        <div className="app-session-feedback-loop__score-row">
          <span>效率</span>
          <Progress
            percent={scoreToPercent(comparison.efficiencyScore)}
            size="small"
            showInfo={false}
            strokeColor="#06b6d4"
          />
          <span>{comparison.efficiencyScore.toFixed(0)}</span>
        </div>
        <div className="app-session-feedback-loop__score-row">
          <span>质量</span>
          <Progress
            percent={scoreToPercent(comparison.qualityScore)}
            size="small"
            showInfo={false}
            strokeColor="#a855f7"
          />
          <span>{comparison.qualityScore.toFixed(0)}</span>
        </div>
      </div>
      {expanded ? (
        <pre className="app-session-feedback-loop__delta-md">{formatComparisonMarkdown(comparison)}</pre>
      ) : null}
    </div>
  );
}

export const SessionFeedbackLoopPanel = memo(function SessionFeedbackLoopPanel({
  loop,
  featureEnabled,
  injectHabitsToSystemPrompt = false,
  optimizeConfigArtifacts = false,
  onDispatchSessionFeedbackLoop,
}: Props) {
  const { state, isActive, habits, historyRecords, historyComparison, start, stop, reset, forceCompare, saveHabitsToComposer, requestFinalSummary, requestHabitsPrompt, exportMarkdownReport } = loop;

  const phaseLabel = PHASE_LABEL[state.phase];
  const completedCycles = useMemo(
    () => state.cycles.filter((c) => c.comparison != null),
    [state.cycles],
  );

  const handleStart = useCallback(() => {
    if (!featureEnabled) {
      message.info("请先在「默认配置 → 开发实验」中开启「反馈神经网」");
      return;
    }
    start();
    message.info("反馈神经网已启动：优化请求将派至独立 worker 会话");
  }, [featureEnabled, start]);

  const handleSummary = useCallback(async () => {
    const prompt = requestFinalSummary();
    if (!prompt || !onDispatchSessionFeedbackLoop) {
      message.info("暂无完整循环数据");
      return;
    }
    try {
      await onDispatchSessionFeedbackLoop(prompt, "summary");
      message.success("已派发循环总结至神经网 worker");
    } catch (e) {
      message.error(`派发失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onDispatchSessionFeedbackLoop, requestFinalSummary]);

  const handleExport = useCallback(async () => {
    const text = exportMarkdownReport();
    if (!text) {
      message.info("暂无可导出内容");
      return;
    }
    try {
      const path = await save({
        defaultPath: `session-feedback-loop-${Date.now()}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return;
      await writeTextFileAbsolute(path, text);
      message.success("反馈神经网报告已导出");
    } catch (e) {
      message.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [exportMarkdownReport]);

  const handleHabitsAi = useCallback(async () => {
    const prompt = requestHabitsPrompt();
    if (!prompt || !onDispatchSessionFeedbackLoop) {
      message.info("暂无习惯沉淀数据");
      return;
    }
    try {
      await onDispatchSessionFeedbackLoop(prompt, "habits");
      message.success("已派发习惯沉淀至神经网 worker");
    } catch (e) {
      message.error(`派发失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [onDispatchSessionFeedbackLoop, requestHabitsPrompt]);

  const handleSaveHabits = useCallback(async () => {
    try {
      const ok = await saveHabitsToComposer();
      if (ok) message.success("已写入 Composer 常用语「神经网习惯」");
      else message.info("暂无可用习惯");
    } catch (e) {
      message.error(`写入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [saveHabitsToComposer]);

  if (!featureEnabled) {
    return (
      <section className="app-session-feedback-loop app-session-feedback-loop--disabled">
        <div className="app-session-feedback-loop__head">
          <ApiOutlined className="app-session-feedback-loop__icon" />
          <div>
            <Text className="app-session-feedback-loop__title">反馈神经网</Text>
            <Text type="secondary" className="app-session-feedback-loop__hint">
              开发功能已关闭。在 Author → 默认配置 → 开发实验 中开启后可启用轮次分析 → 自我优化 → 比对 → 再优化闭环。
            </Text>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="app-session-feedback-loop">
      <div className="app-session-feedback-loop__head">
        <ApiOutlined className="app-session-feedback-loop__icon" />
        <div className="app-session-feedback-loop__head-main">
          <Text className="app-session-feedback-loop__title">反馈神经网</Text>
          <Text type="secondary" className="app-session-feedback-loop__hint">
            增量轮次比对 · 收敛早停 · 最多 {state.maxCycles} 轮自我优化循环
          </Text>
        </div>
        <Tag
          bordered={false}
          className={`app-session-feedback-loop__phase app-session-feedback-loop__phase--${state.phase}`}
        >
          {phaseLabel}
          {state.currentCycleIndex > 0 ? ` · ${state.currentCycleIndex}/${state.maxCycles}` : ""}
          {state.completionReason ? ` · ${COMPLETION_LABEL[state.completionReason]}` : ""}
        </Tag>
      </div>

      <div className="app-session-feedback-loop__actions">
        <Space size={4} wrap>
          {!isActive ? (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={handleStart}>
              启动闭环
            </Button>
          ) : (
            <Button size="small" icon={<PauseCircleOutlined />} onClick={stop}>
              停止
            </Button>
          )}
          {state.phase === "awaiting_turns" ? (
            <Button size="small" icon={<SyncOutlined />} onClick={forceCompare}>
              立即比对
            </Button>
          ) : null}
          <Button size="small" icon={<ReloadOutlined />} onClick={reset} disabled={isActive}>
            重置
          </Button>
          {completedCycles.length > 0 && onDispatchSessionFeedbackLoop ? (
            <>
              <Button size="small" icon={<RobotOutlined />} onClick={() => void handleSummary()}>
                AI 总结
              </Button>
              <Button size="small" icon={<RobotOutlined />} onClick={() => void handleHabitsAi()}>
                AI 习惯
              </Button>
            </>
          ) : null}
          {habits.length > 0 ? (
            <Button size="small" icon={<SaveOutlined />} onClick={() => void handleSaveHabits()}>
              写入常用语
            </Button>
          ) : null}
          {(completedCycles.length > 0 || state.phase !== "idle") && (
            <Button size="small" icon={<DownloadOutlined />} onClick={() => void handleExport()}>
              导出
            </Button>
          )}
        </Space>
      </div>

      {state.phase === "awaiting_turns" ? (
        <Text type="secondary" className="app-session-feedback-loop__waiting">
          已发送自我优化请求，请继续对话产生新轮次；系统将仅对<strong>新增轮次</strong>做增量比对（后台自动跟踪，无需保持洞察页打开）。也可点「立即比对」强制刷新。
        </Text>
      ) : null}

      {historyRecords.length > 0 ? (
        <div className="app-session-feedback-loop__history">
          <div className="app-session-feedback-loop__history-head">
            <HistoryOutlined />
            <Text type="secondary">本仓库历史闭环（{historyRecords.length}）</Text>
            {historyComparison.average != null && historyComparison.delta != null ? (
              <Tag bordered={false} color={historyComparison.delta >= 0 ? "success" : "default"}>
                较均 {historyComparison.delta >= 0 ? "+" : ""}
                {historyComparison.delta.toFixed(1)}（均 {historyComparison.average.toFixed(1)}）
              </Tag>
            ) : null}
          </div>
          <div className="app-session-feedback-loop__history-list">
            {historyRecords.slice(0, 4).map((rec) => (
              <div key={rec.id} className="app-session-feedback-loop__history-row">
                <span>{new Date(rec.completedAt).toLocaleString()}</span>
                <span>
                  {rec.cycleCount} 轮 · 得分 {rec.finalOverallScore?.toFixed(1) ?? "—"}
                </span>
                <span>{rec.finalSummary}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {habits.length > 0 ? (
        <div className="app-session-feedback-loop__habits">
          <div className="app-session-feedback-loop__habits-head">
            <Text type="secondary" className="app-session-feedback-loop__habits-title">
              沉淀习惯
            </Text>
            {injectHabitsToSystemPrompt ? (
              <Tag bordered={false} color="processing">
                已启用 System Prompt 注入（新会话 spawn 生效）
              </Tag>
            ) : null}
          </div>
          <ul className="app-session-feedback-loop__habits-list">
            {habits.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {completedCycles.length > 0 ? <TrendChart cycles={state.cycles} /> : null}

      <SessionFeedbackConfigPatchPanel
        loop={loop}
        optimizeConfigArtifacts={optimizeConfigArtifacts}
        onDispatchSessionFeedbackLoop={onDispatchSessionFeedbackLoop}
      />

      {state.cycles.length > 0 ? (
        <div className="app-session-feedback-loop__cycles">
          {state.cycles.map((cycle) => (
            <CycleCard key={cycle.cycleIndex} cycle={cycle} />
          ))}
        </div>
      ) : null}

      {state.phase === "completed" && completedCycles.length > 0 ? (
        <div className="app-session-feedback-loop__final">
          <Text type="secondary">
            最终对比
            {state.completionReason === "converged" ? "（指标已收敛，提前结束）" : ""}
          </Text>
          <pre className="app-session-feedback-loop__final-md">
            {formatComparisonMarkdown(completedCycles[completedCycles.length - 1]!.comparison!)}
          </pre>
        </div>
      ) : null}
    </section>
  );
});
