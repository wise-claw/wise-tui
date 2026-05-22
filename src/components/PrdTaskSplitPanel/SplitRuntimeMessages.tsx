import { useMemo, useState, type RefObject } from "react";
import { Button, Space } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClockCircleOutlined,
  SyncOutlined,
  MessageOutlined,
} from "@ant-design/icons";
import { SplitRuntimeMessageRow } from "./SplitRuntimeMessageRow";
import { buildSplitRuntimeModel, type RuntimeStepState } from "./splitRuntimeModel";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";
import type { ClusterRunState } from "../PrdSplitWizard/types";

interface Props {
  logs: SplitRuntimeLogItem[];
  listRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  onRetryStage: (phase: SplitRetryPhase) => void;
  clusterRuns?: ClusterRunState[];
  onRetryCluster?: (clusterId: string) => void;
  onCancelCluster?: (clusterId: string) => void;
}

export function SplitRuntimeMessages({
  logs,
  listRef,
  retryingPhase,
  onRetryStage,
  clusterRuns = [],
  onRetryCluster,
  onCancelCluster,
}: Props) {
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const runtime = useMemo(() => buildSplitRuntimeModel(logs), [logs]);
  const clusterRunById = useMemo(
    () => new Map(clusterRuns.map((run) => [run.clusterId, run])),
    [clusterRuns],
  );

  const mainLogs = useMemo(
    () => logs.filter((log) => !log.clusterId || (log.scope ?? "main") === "main"),
    [logs],
  );

  const activeSubagent = activeClusterId
    ? runtime.subagents.find((item) => item.clusterId === activeClusterId) ?? null
    : null;
  const activeRun = activeClusterId ? clusterRunById.get(activeClusterId) ?? null : null;

  return (
    <div className="app-prd-task-panel__split-runtime-list">
      <div className="app-prd-task-panel__runtime-console">
        {/* 全局阶段进度条 */}
        <RuntimeStageProgress stages={runtime.stages} activeStageIndex={runtime.activeStageIndex} />

        {/* 多路并发子代理会话切换 Tabs */}
        {logs.length > 0 && (
          <div className="app-prd-task-panel__subagent-tabs">
            {/* 主会话 Tab */}
            <button
              type="button"
              className={[
                "app-prd-task-panel__subagent-tab",
                activeClusterId === null ? "is-active" : "",
              ].filter(Boolean).join(" ")}
              onClick={() => setActiveClusterId(null)}
            >
              <MessageOutlined className="app-prd-task-panel__subagent-tab-icon" />
              <span>主会话</span>
            </button>

            {/* 子代理 Tabs */}
            {runtime.subagents.map((subagent) => {
              const isActive = activeClusterId === subagent.clusterId;
              return (
                <button
                  type="button"
                  key={subagent.clusterId}
                  className={[
                    "app-prd-task-panel__subagent-tab",
                    `app-prd-task-panel__subagent-tab--${subagent.status}`,
                    isActive ? "is-active" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => setActiveClusterId(subagent.clusterId)}
                >
                  {renderStatusIcon(subagent.status)}
                  <span>C{subagent.ordinal}: {subagent.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 对话消息流区域 */}
      <div ref={listRef} className="app-claude-messages app-prd-task-panel__split-runtime-messages">
        {logs.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无处理记录</p>
          </div>
        ) : activeClusterId === null ? (
          /* ================================== 主会话视图 ================================== */
          <div className="app-prd-task-panel__runtime-main-view">
            <div className="app-prd-task-panel__runtime-main-line">
              <MessageOutlined className="app-prd-task-panel__runtime-main-icon" />
              <div>
                <span>主会话运行摘要</span>
                <p>{runtime.mainSummary}</p>
              </div>
            </div>
            
            {/* 主会话消息日志流 */}
            <div className="app-prd-task-panel__runtime-chat-stream">
              {mainLogs.map((log) => (
                <SplitRuntimeMessageRow
                  key={log.id}
                  log={log}
                  retryingPhase={retryingPhase}
                  onRetryStage={onRetryStage}
                />
              ))}
            </div>
          </div>
        ) : (
          /* ================================== 子代理会话视图 ================================== */
          activeSubagent && (
            <div className="app-prd-task-panel__runtime-subagent-view">
              {/* 子代理控制舱状态头部 */}
              <div className="app-prd-task-panel__runtime-subagent-header">
                <div className="app-prd-task-panel__runtime-subagent-header-title">
                  <span className="app-prd-task-panel__runtime-subagent-ordinal">C{activeSubagent.ordinal}</span>
                  <div>
                    <strong>{activeSubagent.title} · Cluster {activeSubagent.ordinal}/{activeSubagent.total}</strong>
                    <small>{activeSubagent.waitingReason ?? activeSubagent.clusterId ?? ""}</small>
                  </div>
                </div>
                <Space size={6} className="app-prd-task-panel__runtime-subagent-actions">
                  <span className={`app-prd-task-panel__status-chip app-prd-task-panel__status-chip--${activeSubagent.status}`}>
                    {activeSubagent.statusLabel}
                  </span>
                  {activeRun?.status === "dispatching" ? (
                    <Button size="small" danger onClick={() => onCancelCluster?.(activeRun.clusterId)}>
                      一键中断
                    </Button>
                  ) : null}
                  {activeRun && (activeRun.status === "failed" || activeRun.status === "cancelled") ? (
                    <Button size="small" type="primary" onClick={() => onRetryCluster?.(activeRun.clusterId)}>
                      立即重试
                    </Button>
                  ) : null}
                </Space>
              </div>

              {/* 环境及物理输出 Artifacts */}
              {activeRun ? <ClusterRunArtifacts run={activeRun} /> : null}

              {/* 思维折叠舱 (Collapsible Thinking Box) */}
              <ThinkingBox subagent={activeSubagent} />

              {/* 子代理专有消息日志流 */}
              <div className="app-prd-task-panel__runtime-chat-stream">
                {activeSubagent.logs.map((log) => (
                  <SplitRuntimeMessageRow
                    key={log.id}
                    log={log}
                    retryingPhase={retryingPhase}
                    onRetryStage={onRetryStage}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function renderStatusIcon(status: string) {
  switch (status) {
    case "running":
      return <SyncOutlined spin className="app-prd-task-panel__subagent-tab-icon is-running" />;
    case "succeeded":
      return <CheckCircleFilled className="app-prd-task-panel__subagent-tab-icon is-succeeded" />;
    case "failed":
      return <CloseCircleFilled className="app-prd-task-panel__subagent-tab-icon is-failed" />;
    case "cancelled":
      return <CloseCircleFilled className="app-prd-task-panel__subagent-tab-icon is-cancelled" />;
    case "queued":
    default:
      return <ClockCircleOutlined className="app-prd-task-panel__subagent-tab-icon is-queued" />;
  }
}

function ThinkingBox({ subagent }: { subagent: ReturnType<typeof buildSplitRuntimeModel>["subagents"][0] }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = subagent.issueCount > 0;
  
  return (
    <div className={[
      "app-prd-task-panel__thinking-box",
      expanded ? "is-expanded" : "",
      hasIssues ? "has-issues" : "",
    ].filter(Boolean).join(" ")}>
      <div 
        className="app-prd-task-panel__thinking-box-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="app-prd-task-panel__thinking-box-header-title">
          <span className="app-prd-task-panel__thinking-box-icon">🧠</span>
          <strong>思考路径</strong>
          <span className="app-prd-task-panel__thinking-box-summary">
            {subagent.thinking}
          </span>
        </div>
        <span className="app-prd-task-panel__thinking-box-arrow">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </div>
      
      {expanded && (
        <div className="app-prd-task-panel__thinking-box-body">
          {/* 步骤 Timeline */}
          <div className="app-prd-task-panel__thinking-section">
            <span className="app-prd-task-panel__thinking-section-title">执行步骤</span>
            <div className="app-prd-task-panel__thinking-steps">
              {subagent.steps.map((step, index) => (
                <div key={`${step.label}-${index}`} className="app-prd-task-panel__thinking-step">
                  <StepDot state={step.state} />
                  <span className={`app-prd-task-panel__thinking-step-label is-${step.state}`}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          {/* 产出候选 */}
          <div className="app-prd-task-panel__thinking-section">
            <span className="app-prd-task-panel__thinking-section-title">产出候选</span>
            <div className="app-prd-task-panel__thinking-outputs">
              {subagent.outputs.map((output, index) => (
                <span 
                  key={`${output.title}-${index}`}
                  className={[
                    "app-prd-task-panel__thinking-output",
                    `app-prd-task-panel__thinking-output--${output.state}`,
                  ].join(" ")}
                >
                  {output.title}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClusterRunArtifacts({ run }: { run: ClusterRunState }) {
  const details = [
    ["运行目录", run.raw?.runDir ?? ""],
    ["标准输出", run.raw?.stdoutPath ?? run.progress?.error?.stdoutPath ?? ""],
    ["标准错误", run.raw?.stderrPath ?? run.progress?.error?.stderrPath ?? ""],
    ["物理结果", run.raw?.rawResultPath ?? ""],
    ["父级任务", run.parentTaskPath ?? ""],
  ].filter(([, value]) => value.trim().length > 0);
  if (details.length === 0) return null;
  return (
    <div className="app-prd-task-panel__runtime-artifacts">
      {details.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <code>{value}</code>
        </div>
      ))}
    </div>
  );
}

function RuntimeStageProgress({
  stages,
  activeStageIndex,
}: {
  stages: ReturnType<typeof buildSplitRuntimeModel>["stages"];
  activeStageIndex: number;
}) {
  return (
    <div className="app-prd-task-panel__runtime-stage-progress" aria-label={`当前阶段 ${activeStageIndex}/${stages.length}`}>
      {stages.map((stage, index) => (
        <div
          key={stage.index}
          className={[
            "app-prd-task-panel__runtime-stage-node",
            `app-prd-task-panel__runtime-stage-node--${stage.status}`,
            stage.index === activeStageIndex ? "is-active" : "",
          ].filter(Boolean).join(" ")}
        >
          <span>阶段 {stage.index}</span>
          <strong>{stage.title}</strong>
          {index < stages.length - 1 ? <i aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

function StepDot({ state }: { state: RuntimeStepState }) {
  return <i className={`app-prd-task-panel__runtime-step-dot app-prd-task-panel__runtime-step-dot--${state}`} />;
}
