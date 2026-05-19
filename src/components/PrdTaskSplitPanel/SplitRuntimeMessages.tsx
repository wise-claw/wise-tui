import { useMemo, useState, type RefObject } from "react";
import { SplitRuntimeMessageRow } from "./SplitRuntimeMessageRow";
import type { SplitRetryPhase, SplitRuntimeLogItem } from "./types";

interface Props {
  logs: SplitRuntimeLogItem[];
  listRef: RefObject<HTMLDivElement | null>;
  retryingPhase: SplitRetryPhase | null;
  onRetryStage: (phase: SplitRetryPhase) => void;
}

export function SplitRuntimeMessages({ logs, listRef, retryingPhase, onRetryStage }: Props) {
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  const runtime = useMemo(() => buildRuntimeModel(logs), [logs]);
  const activeSubagent = activeClusterId
    ? runtime.subagents.find((item) => item.clusterId === activeClusterId) ?? null
    : null;
  return (
    <div className="app-prd-task-panel__split-runtime-list">
      <div ref={listRef} className="app-claude-messages app-prd-task-panel__split-runtime-messages">
        {logs.length === 0 ? (
          <div className="app-claude-messages-empty">
            <p>暂无处理记录</p>
          </div>
        ) : (
          <div className="app-prd-task-panel__runtime-console">
            <div className="app-prd-task-panel__runtime-phases">
              <PhaseCard
                step="阶段 1"
                title="PRD 拆分为任务列表"
                status={runtime.phase1Status}
                meta={`派发 ${runtime.subagents.length} 个子代理`}
              />
              <PhaseCard
                step="阶段 2"
                title="需求溯源与锚点定位"
                status={runtime.phase2Status}
                meta={runtime.phase2Meta}
              />
            </div>
            <div className="app-prd-task-panel__runtime-main-line">
              <span>主会话</span>
              <p>{runtime.mainSummary}</p>
            </div>
            <div className="app-prd-task-panel__runtime-subagent-list">
              <div className="app-prd-task-panel__runtime-subagent-list-head">
                <span>子代理</span>
                <span>{runtime.subagents.length} 个</span>
              </div>
              {runtime.subagents.length === 0 ? (
                <div className="app-prd-task-panel__runtime-subagent-empty">等待派发</div>
              ) : (
                runtime.subagents.map((subagent) => (
                  <button
                    type="button"
                    key={subagent.clusterId}
                    className={[
                      "app-prd-task-panel__runtime-subagent-row",
                      activeClusterId === subagent.clusterId ? "is-active" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setActiveClusterId((current) =>
                      current === subagent.clusterId ? null : subagent.clusterId,
                    )}
                  >
                    <span className="app-prd-task-panel__runtime-subagent-main">
                      <strong>{subagent.title}</strong>
                      <small>{subagent.clusterId}</small>
                    </span>
                    <span className="app-prd-task-panel__runtime-subagent-side">
                      <span className={`app-prd-task-panel__runtime-status app-prd-task-panel__runtime-status--${subagent.status}`}>
                        {runtimeStatusLabel(subagent.status)}
                      </span>
                      <span className="app-prd-task-panel__runtime-subagent-meta">
                        {subagent.taskCount != null ? `${subagent.taskCount} 任务` : "生成中"}
                        {subagent.issueCount > 0 ? ` · ${subagent.issueCount} 问题` : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            {activeSubagent ? (
              <div className="app-prd-task-panel__runtime-detail">
                <div className="app-prd-task-panel__runtime-detail-head">
                  <div>
                    <span>对话流</span>
                    <strong>{activeSubagent.title}</strong>
                  </div>
                  <button type="button" onClick={() => setActiveClusterId(null)}>收起</button>
                </div>
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

function PhaseCard({
  step,
  title,
  status,
  meta,
}: {
  step: string;
  title: string;
  status: RuntimeStatus;
  meta: string;
}) {
  return (
    <div className={`app-prd-task-panel__runtime-phase app-prd-task-panel__runtime-phase--${status}`}>
      <span>{step}</span>
      <strong>{title}</strong>
      <small>{meta}</small>
    </div>
  );
}

type RuntimeStatus = NonNullable<SplitRuntimeLogItem["status"]>;

interface SubagentRuntime {
  clusterId: string;
  title: string;
  status: RuntimeStatus;
  taskCount: number | null;
  issueCount: number;
  logs: SplitRuntimeLogItem[];
}

function buildRuntimeModel(logs: SplitRuntimeLogItem[]) {
  const clusterIds = new Set<string>();
  for (const log of logs) {
    if (log.clusterId?.trim()) clusterIds.add(log.clusterId.trim());
  }
  const subagents: SubagentRuntime[] = [...clusterIds].map((clusterId) => {
    const clusterLogs = logs
      .filter((log) => log.clusterId === clusterId)
      .sort((a, b) => a.at - b.at);
    const latest = clusterLogs[clusterLogs.length - 1];
    const complete = [...clusterLogs].reverse().find((log) => log.scope === "subagent" && log.details?.length);
    const validationIssues = getRuntimeDetail(complete, "validationIssues");
    return {
      clusterId,
      title: clusterLogs.find((log) => log.title)?.title ?? clusterId,
      status: latest?.status ?? "queued",
      taskCount: parseNullableNumber(getRuntimeDetail(complete, "taskCount")),
      issueCount: validationIssues ? validationIssues.split("\n").filter((line) => line.trim()).length : 0,
      logs: clusterLogs,
    };
  });
  const anyFailed = subagents.some((item) => item.status === "failed" || item.status === "cancelled");
  const allDone = subagents.length > 0 && subagents.every((item) => item.status === "succeeded");
  const anyRunning = subagents.some((item) => item.status === "running");
  const phase1Status: RuntimeStatus = anyFailed ? "failed" : allDone ? "succeeded" : anyRunning ? "running" : "queued";
  const finalDone = logs.some((log) => log.scope === "main" && log.status === "succeeded");
  const phase2Running = logs.some((log) => log.scope === "main" && log.status === "running" && log.title === "阶段 2");
  const phase2Status: RuntimeStatus = finalDone ? "succeeded" : phase2Running ? "running" : "queued";
  const phase2Meta = finalDone
    ? "已生成任务列表"
    : phase2Running
      ? "正在收集结果"
      : anyFailed
        ? "等待修复后重试"
        : "等待阶段 1";
  const mainSummary = finalDone
    ? "主会话已收集子代理返回，并把结果转换为右侧任务列表。"
    : anyFailed
      ? "主会话已收到子代理返回，但有分组未通过校验，可展开对应子代理查看原因。"
      : subagents.length === 0
        ? "主会话正在读取 PRD，准备按需求范围派发子代理。"
        : `主会话已派发 ${subagents.length} 个 trellis-splitter，等待返回后进入阶段 2。`;
  return { phase1Status, phase2Status, phase2Meta, subagents, mainSummary };
}

function getRuntimeDetail(log: SplitRuntimeLogItem | undefined, label: string): string | null {
  return log?.details?.find((detail) => detail.label === label)?.value ?? null;
}

function parseNullableNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function runtimeStatusLabel(status: RuntimeStatus): string {
  switch (status) {
    case "queued":
      return "等待";
    case "running":
      return "运行中";
    case "succeeded":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已中断";
    case "info":
    default:
      return "记录";
  }
}
