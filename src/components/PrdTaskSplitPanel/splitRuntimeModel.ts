import type { SplitRuntimeLogItem, SplitRuntimeLogStatus } from "./types";

export type RuntimeStepState = "done" | "active" | "pending" | "failed";
export type RuntimeOutputState = "done" | "active" | "pending";

export interface RuntimeStageView {
  index: number;
  title: string;
  status: SplitRuntimeLogStatus;
}

export interface RuntimeStepView {
  label: string;
  state: RuntimeStepState;
}

export interface RuntimeOutputView {
  title: string;
  state: RuntimeOutputState;
}

export interface SubagentRuntimeView {
  clusterId: string;
  title: string;
  ordinal: number;
  total: number;
  status: SplitRuntimeLogStatus;
  statusLabel: string;
  summary: string;
  thinking: string;
  steps: RuntimeStepView[];
  outputs: RuntimeOutputView[];
  issueCount: number;
  logs: SplitRuntimeLogItem[];
  waitingReason: string | null;
}

export interface SplitRuntimeModel {
  stages: RuntimeStageView[];
  activeStageIndex: number;
  mainSummary: string;
  subagents: SubagentRuntimeView[];
}

export function buildSplitRuntimeModel(logs: SplitRuntimeLogItem[]): SplitRuntimeModel {
  const orderedLogs = [...logs].sort((a, b) => a.at - b.at);
  const clusterIds = collectClusterIds(orderedLogs);
  const subagents = clusterIds.map((clusterId, index) =>
    buildSubagentView(clusterId, index, clusterIds.length, orderedLogs),
  );
  const anyFailed = subagents.some((item) => item.status === "failed" || item.status === "cancelled");
  const allDone = subagents.length > 0 && subagents.every((item) => item.status === "succeeded");
  const anyRunning = subagents.some((item) => item.status === "running");
  const finalDone = orderedLogs.some((log) => log.scope === "main" && log.status === "succeeded");
  const phase2Running = orderedLogs.some((log) => log.scope === "main" && log.status === "running" && log.title === "阶段 2");
  const phase1Status: SplitRuntimeLogStatus = anyFailed ? "failed" : allDone ? "succeeded" : anyRunning ? "running" : "queued";
  const phase2Status: SplitRuntimeLogStatus = finalDone ? "succeeded" : phase2Running ? "running" : "queued";
  const activeStageIndex = phase2Status === "running" || phase2Status === "succeeded" ? 2 : 1;

  return {
    stages: [
      { index: 1, title: "Cluster fan-out 拆分", status: phase1Status },
      { index: 2, title: "Verifier 合并校验", status: phase2Status },
      { index: 3, title: "交给编排层生成 DAG", status: phase2Status },
    ],
    activeStageIndex: phase2Status === "succeeded" ? 3 : activeStageIndex,
    mainSummary: buildMainSummary({ subagents, finalDone, anyFailed }),
    subagents,
  };
}

function collectClusterIds(logs: SplitRuntimeLogItem[]): string[] {
  const out: string[] = [];
  for (const log of logs) {
    const clusterId = log.clusterId?.trim();
    if (!clusterId || out.includes(clusterId)) continue;
    out.push(clusterId);
  }
  return out;
}

function buildSubagentView(
  clusterId: string,
  index: number,
  total: number,
  logs: SplitRuntimeLogItem[],
): SubagentRuntimeView {
  const clusterLogs = logs.filter((log) => log.clusterId?.trim() === clusterId);
  const subagentLogs = clusterLogs.filter((log) => (log.scope ?? "main") === "subagent");
  const latest = subagentLogs[subagentLogs.length - 1] ?? clusterLogs[clusterLogs.length - 1];
  const complete = [...subagentLogs].reverse().find((log) =>
    log.status === "succeeded" || log.status === "failed" || log.status === "cancelled"
  );
  const parentCreated = clusterLogs.some((log) =>
    log.details?.some((detail) => detail.label === "parentTask" && detail.value.trim())
  );
  const status = latest?.status ?? "queued";
  const taskTitles = splitDetailList(getRuntimeDetail(complete, "taskTitles"));
  const taskCount = parseNullableNumber(getRuntimeDetail(complete, "taskCount"));
  const issueText = getRuntimeDetail(complete, "validationIssues");
  const issueCount = issueText ? issueText.split("\n").filter((line) => line.trim()).length : 0;
  const title = clusterLogs.find((log) => log.title?.trim())?.title?.trim() ?? clusterId;
  const waitingReason = status === "queued" && index > 0
    ? `等待 cluster ${index} 输出候选任务`
    : status === "queued"
      ? "等待 splitter 派发"
      : null;

  return {
    clusterId,
    title,
    ordinal: index + 1,
    total,
    status,
    statusLabel: runtimeStatusLabel(status),
    summary: buildSubagentSummary(status, taskCount, issueCount, waitingReason),
    thinking: buildThinkingLine(status, taskTitles, parentCreated, issueCount),
    steps: buildSubagentSteps({ status, parentCreated, taskCount, issueCount }),
    outputs: buildOutputs({ status, taskTitles, taskCount }),
    issueCount,
    logs: clusterLogs,
    waitingReason,
  };
}

function buildSubagentSteps(input: {
  status: SplitRuntimeLogStatus;
  parentCreated: boolean;
  taskCount: number | null;
  issueCount: number;
}): RuntimeStepView[] {
  const completed = input.status === "succeeded";
  const failed = input.status === "failed" || input.status === "cancelled";
  return [
    {
      label: "读取 cluster PRD 切片",
      state: input.status === "queued" ? "pending" : "done",
    },
    {
      label: "启动 Claude Code splitter 子代理",
      state: input.parentCreated ? "done" : input.status === "running" ? "active" : input.status === "queued" ? "pending" : failed ? "failed" : "done",
    },
    {
      label: input.issueCount > 0 ? "Verifier 发现结构问题" : "输出任务/锚点/初始依赖",
      state: completed ? "done" : failed ? "failed" : input.parentCreated ? "active" : "pending",
    },
    {
      label: input.taskCount != null ? `回传 ${input.taskCount} 个候选任务` : "等待候选任务生成",
      state: completed ? "done" : failed ? "failed" : input.parentCreated ? "active" : "pending",
    },
  ];
}

function buildOutputs(input: {
  status: SplitRuntimeLogStatus;
  taskTitles: string[];
  taskCount: number | null;
}): RuntimeOutputView[] {
  if (input.taskTitles.length > 0) {
    return input.taskTitles.map((title) => ({ title, state: "done" }));
  }
  if (input.taskCount != null && input.taskCount > 0) {
    return Array.from({ length: input.taskCount }, (_, index) => ({
      title: `任务 ${index + 1}`,
      state: "done",
    }));
  }
  return [{
    title: input.status === "queued" ? "等待子代理输出" : "正在生成候选任务",
    state: input.status === "queued" ? "pending" : "active",
  }];
}

function buildSubagentSummary(
  status: SplitRuntimeLogStatus,
  taskCount: number | null,
  issueCount: number,
  waitingReason: string | null,
): string {
  if (status === "succeeded") return taskCount != null ? `已产出 ${taskCount} 个任务` : "已完成任务拆分";
  if (status === "failed") return issueCount > 0 ? `${issueCount} 个校验问题待处理` : "拆分失败，等待查看详情";
  if (status === "cancelled") return "已中断";
  if (status === "queued") return waitingReason ?? "等待启动";
  return "正在拆分 PRD cluster";
}

function buildThinkingLine(
  status: SplitRuntimeLogStatus,
  taskTitles: string[],
  parentCreated: boolean,
  issueCount: number,
): string {
  if (status === "queued") return "等待 fan-out 调度后接收 cluster 输入。";
  if (status === "succeeded") {
    const latestTask = taskTitles[taskTitles.length - 1];
    return latestTask ? `已确认「${latestTask}」可进入编排层。` : "已完成候选任务、锚点与初始依赖回传。";
  }
  if (status === "failed") return issueCount > 0 ? "正在等待校验问题复核。" : "正在等待失败详情复核。";
  if (!parentCreated) return "正在准备 splitter 输入 bundle 与分组上下文。";
  return "正在分析需求边界、任务依赖与 markdown/rich text 锚点。";
}

function buildMainSummary(input: {
  subagents: SubagentRuntimeView[];
  finalDone: boolean;
  anyFailed: boolean;
}): string {
  if (input.finalDone) return "主会话已合并 splitter 返回，并把候选任务交给编排层生成 DAG。";
  if (input.anyFailed) return "主会话已收到 splitter 返回，但有分组未通过 verifier 校验，可展开查看原因。";
  if (input.subagents.length === 0) return "主会话正在读取 PRD，准备按 cluster fan-out 派发 splitter。";
  const running = input.subagents.find((item) => item.status === "running");
  if (running) return `正在处理 Cluster ${running.ordinal}/${running.total}：${running.title}`;
  return `已规划 ${input.subagents.length} 个 cluster，等待第一批 splitter 启动。`;
}

function getRuntimeDetail(log: SplitRuntimeLogItem | undefined, label: string): string | null {
  return log?.details?.find((detail) => detail.label === label)?.value ?? null;
}

function splitDetailList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseNullableNumber(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function runtimeStatusLabel(status: SplitRuntimeLogStatus): string {
  switch (status) {
    case "queued":
      return "等待";
    case "running":
      return "生成中";
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
