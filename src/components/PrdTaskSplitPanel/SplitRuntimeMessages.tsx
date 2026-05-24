import { useMemo, useState, type RefObject } from "react";
import { Button, Space } from "antd";
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
  const activeSubagent = activeClusterId
    ? runtime.subagents.find((item) => item.clusterId === activeClusterId) ?? null
    : null;
  const activeRun = activeClusterId ? clusterRunById.get(activeClusterId) ?? null : null;
  return (
    <div className="app-prd-task-panel__split-runtime-list">
      <div ref={listRef} className="app-claude-messages app-prd-task-panel__split-runtime-messages">
        {logs.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无处理记录</p>
          </div>
        ) : (
          <div className="app-prd-task-panel__runtime-console">
            <RuntimeStageProgress stages={runtime.stages} activeStageIndex={runtime.activeStageIndex} />
            <div className="app-prd-task-panel__runtime-main-line">
              <span>主会话</span>
              <p>{runtime.mainSummary}</p>
            </div>
            <div className="app-prd-task-panel__runtime-subagent-list">
              <div className="app-prd-task-panel__runtime-subagent-list-head">
                <span>任务生成</span>
                <span>{runtime.subagents.length} 个</span>
              </div>
              {runtime.subagents.length === 0 ? (
                <div className="app-prd-task-panel__runtime-subagent-empty">等待开始</div>
              ) : (
                runtime.subagents.map((subagent) => (
                  <button
                    type="button"
                    key={subagent.clusterId}
                    className={[
                      "app-prd-task-panel__runtime-subagent-row",
                      `app-prd-task-panel__runtime-subagent-row--${subagent.status}`,
                      activeClusterId === subagent.clusterId ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setActiveClusterId((current) =>
                      current === subagent.clusterId ? null : subagent.clusterId,
                    )}
                  >
                    <span className="app-prd-task-panel__runtime-subagent-main">
                      <span className="app-prd-task-panel__runtime-subagent-avatar">{subagent.ordinal}</span>
                      <span className="app-prd-task-panel__runtime-subagent-title">
                        <strong>{subagent.title} · 第 {subagent.ordinal}/{subagent.total} 组</strong>
                        <small>{subagent.waitingReason ?? subagent.clusterId}</small>
                      </span>
                    </span>
                    <span className="app-prd-task-panel__runtime-subagent-side">
                      <span className={`app-prd-task-panel__runtime-status app-prd-task-panel__runtime-status--${subagent.status}`}>
                        {subagent.statusLabel}
                      </span>
                      <span className="app-prd-task-panel__runtime-subagent-meta">
                        {subagent.summary}
                        {subagent.issueCount > 0 ? ` · ${subagent.issueCount} 问题` : ""}
                      </span>
                    </span>
                    <span className="app-prd-task-panel__runtime-subagent-steps">
                      {subagent.steps.map((step) => (
                        <span key={step.label} className="app-prd-task-panel__runtime-step">
                          <StepDot state={step.state} />
                          <span>{step.label}</span>
                        </span>
                      ))}
                    </span>
                    <span className="app-prd-task-panel__runtime-thinking">
                      <span>生成依据</span>
                      <small>{subagent.thinking}</small>
                    </span>
                    <span className="app-prd-task-panel__runtime-output-list">
                      {subagent.outputs.map((output, index) => (
                        <span
                          key={`${output.title}-${index}`}
                          className={[
                            "app-prd-task-panel__runtime-output",
                            `app-prd-task-panel__runtime-output--${output.state}`,
                          ].join(" ")}
                        >
                          {output.title}
                        </span>
                      ))}
                    </span>
                  </button>
                ))
              )}
            </div>
            {activeSubagent ? (
              <div className="app-prd-task-panel__runtime-detail">
                <div className="app-prd-task-panel__runtime-detail-head">
                  <div>
                    <span>高级运行详情</span>
                    <strong>{activeSubagent.title}</strong>
                  </div>
                  <Space size={6}>
                    {activeRun?.status === "dispatching" ? (
                      <Button size="small" danger onClick={() => onCancelCluster?.(activeRun.clusterId)}>中断</Button>
                    ) : null}
                    {activeRun && (activeRun.status === "failed" || activeRun.status === "cancelled") ? (
                      <Button size="small" onClick={() => onRetryCluster?.(activeRun.clusterId)}>重试</Button>
                    ) : null}
                    <button type="button" onClick={() => setActiveClusterId(null)}>收起</button>
                  </Space>
                </div>
                {activeRun ? <ClusterRunArtifacts run={activeRun} /> : null}
                {activeSubagent.logs.map((log) => (
                  <SplitRuntimeMessageRow
                    key={log.id}
                    log={log}
                    retryingPhase={retryingPhase}
                    onRetryStage={onRetryStage}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ClusterRunArtifacts({ run }: { run: ClusterRunState }) {
  const details = [
    ["状态", run.status],
    ["运行目录", run.raw?.runDir ?? ""],
    ["标准输出", run.raw?.stdoutPath ?? run.progress?.error?.stdoutPath ?? ""],
    ["错误输出", run.raw?.stderrPath ?? run.progress?.error?.stderrPath ?? ""],
    ["原始结果", run.raw?.rawResultPath ?? ""],
    ["任务来源", run.parentTaskPath ?? ""],
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
          <span className="app-prd-task-panel__runtime-stage-marker" aria-hidden="true" />
          <div className="app-prd-task-panel__runtime-stage-copy">
            <span>阶段 {stage.index}</span>
            <strong>{stage.title}</strong>
          </div>
          {index < stages.length - 1 ? <i className="app-prd-task-panel__runtime-stage-connector" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

function StepDot({ state }: { state: RuntimeStepState }) {
  return <i className={`app-prd-task-panel__runtime-step-dot app-prd-task-panel__runtime-step-dot--${state}`} />;
}
