import type {
  CollabAgentStatus,
  CollabArtifactValidation,
  CollabAttemptState,
  CollabBusinessStatus,
  CollabChangeState,
  CollabControlStatus,
  CollabDispatchMode,
  CollabRequirement,
  CollabTaskKind,
  CollabTaskState,
} from "../../types/collaboration";

/** AntD Tag 预设色。 */
export type CollabTone = "default" | "processing" | "success" | "warning" | "error";

interface LabelEntry {
  label: string;
  tone: CollabTone;
}

export const TASK_STATE_LABELS: Record<CollabTaskState, LabelEntry> = {
  waiting_dependencies: { label: "等待依赖", tone: "default" },
  ready: { label: "待执行", tone: "default" },
  running: { label: "执行中", tone: "processing" },
  waiting_change: { label: "等待修正", tone: "warning" },
  checking: { label: "校验中", tone: "processing" },
  succeeded: { label: "已完成", tone: "success" },
  failed: { label: "失败", tone: "error" },
  cancelled: { label: "已取消", tone: "default" },
};

export const TASK_KIND_LABELS: Record<CollabTaskKind, string> = {
  plan: "规划",
  implement: "实现",
  repair: "修复",
  qa: "联调测试",
  env: "环境",
  legacy: "历史任务",
};

export const ATTEMPT_STATE_LABELS: Record<CollabAttemptState, LabelEntry> = {
  claimed: { label: "已领取", tone: "processing" },
  running: { label: "运行中", tone: "processing" },
  stop_requested: { label: "请求停止", tone: "warning" },
  stop_pending: { label: "停止待确认", tone: "warning" },
  lost: { label: "失联", tone: "error" },
  finished: { label: "已结束", tone: "default" },
};

export const CHANGE_STATE_LABELS: Record<CollabChangeState, LabelEntry> = {
  open: { label: "待处理", tone: "warning" },
  triaged: { label: "已分派", tone: "processing" },
  fixing: { label: "修复中", tone: "processing" },
  ready_for_retest: { label: "待复测", tone: "processing" },
  verified: { label: "已验证", tone: "success" },
  closed: { label: "已关闭", tone: "default" },
  needs_decision: { label: "待决策", tone: "error" },
  rejected: { label: "已驳回", tone: "default" },
};

export const ARTIFACT_VALIDATION_LABELS: Record<CollabArtifactValidation, LabelEntry> = {
  pending: { label: "校验中", tone: "processing" },
  valid: { label: "可用", tone: "success" },
  invalid: { label: "不可用", tone: "error" },
  invalidated: { label: "已失效", tone: "default" },
};

export const AGENT_STATUS_LABELS: Record<CollabAgentStatus, LabelEntry> = {
  draft: { label: "草稿", tone: "default" },
  checked: { label: "已检查", tone: "processing" },
  enabled: { label: "已启用", tone: "success" },
  disabled: { label: "已停用", tone: "warning" },
  archived: { label: "已归档", tone: "default" },
};

export const DISPATCH_MODE_LABELS: Record<CollabDispatchMode, { label: string; hint: string }> = {
  discuss: { label: "讨论", hint: "只回答与澄清，不创建任务、不改代码" },
  plan: { label: "规划", hint: "生成跨仓库计划，确认后再执行" },
  execute: { label: "执行", hint: "直接创建需求并由主责智能体规划执行" },
};

const BUSINESS_LABELS: Record<CollabBusinessStatus, string> = {
  open: "进行中",
  verifying: "待验收",
  done: "已完成",
};

const CONTROL_LABELS: Record<CollabControlStatus, LabelEntry | null> = {
  active: null,
  pausing: { label: "暂停中", tone: "warning" },
  paused: { label: "已暂停", tone: "warning" },
  cancelling: { label: "取消中", tone: "warning" },
  cancelled: { label: "已取消", tone: "default" },
};

const STAGE_LABELS: Record<string, string> = {
  planning: "规划中",
  executing: "执行中",
  repairing: "修复联调",
  verifying: "待验收",
  done: "已完成",
  cancelled: "已取消",
};

const DECISION_KIND_LABELS: Record<string, string> = {
  plan_approval: "确认计划",
  scope_expansion: "扩展授权范围",
  attempt_budget: "执行次数用尽",
  requirement_budget: "需求预算用尽",
  repair_budget: "修复轮次用尽",
  dispute: "修正单争议",
  change_triage: "修正单分派",
  compat_unknown: "兼容性待确认",
  binding_revoked: "仓库绑定已撤销",
  requirement_revision: "需求修订确认",
  owner_transfer: "主责移交",
  legacy_target: "指定历史需求仓库",
};

function fallback(value: string): LabelEntry {
  return { label: value || "未知", tone: "default" };
}

export function taskStateLabel(state: string): LabelEntry {
  return TASK_STATE_LABELS[state as CollabTaskState] ?? fallback(state);
}

export function taskKindLabel(kind: string): string {
  return TASK_KIND_LABELS[kind as CollabTaskKind] ?? kind;
}

export function attemptStateLabel(state: string): LabelEntry {
  return ATTEMPT_STATE_LABELS[state as CollabAttemptState] ?? fallback(state);
}

export function changeStateLabel(state: string): LabelEntry {
  return CHANGE_STATE_LABELS[state as CollabChangeState] ?? fallback(state);
}

export function artifactValidationLabel(state: string): LabelEntry {
  return ARTIFACT_VALIDATION_LABELS[state as CollabArtifactValidation] ?? fallback(state);
}

export function agentStatusLabel(status: string): LabelEntry {
  return AGENT_STATUS_LABELS[status as CollabAgentStatus] ?? fallback(status);
}

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function decisionKindLabel(kind: string): string {
  return DECISION_KIND_LABELS[kind] ?? kind;
}

/** 需求总状态：控制态（暂停/取消）优先，其次业务态。 */
export function requirementStatusLabel(
  req: Pick<CollabRequirement, "businessStatus" | "controlStatus" | "stage">,
): LabelEntry {
  const control = CONTROL_LABELS[req.controlStatus];
  if (control) return control;
  if (req.businessStatus === "done") return { label: BUSINESS_LABELS.done, tone: "success" };
  if (req.businessStatus === "verifying") return { label: BUSINESS_LABELS.verifying, tone: "warning" };
  return { label: stageLabel(req.stage) || BUSINESS_LABELS.open, tone: "processing" };
}

export const RESOURCE_KIND_LABELS: Record<string, string> = {
  knowledge: "技术知识",
  delivery: "交付资源",
  capability: "能力引用",
  environment: "环境引用",
};

export function resourceKindLabel(kind: string): string {
  return RESOURCE_KIND_LABELS[kind] ?? kind;
}

export const RESOURCE_VISIBILITY_LABELS: Record<string, { label: string; hint: string }> = {
  source: { label: "来源项目", hint: "仅来源项目可见" },
  space: { label: "协作空间", hint: "所选协作空间的成员项目可见" },
  granted: { label: "指定授权", hint: "来源项目与被授权的项目/智能体/任务可见" },
  agent_private: { label: "智能体私有", hint: "仅来源智能体可见" },
};

export function resourceVisibilityLabel(v: string): string {
  return RESOURCE_VISIBILITY_LABELS[v]?.label ?? v;
}
