import type {
  CollabArtifactVersion,
  CollabChangeRequest,
  CollabDecision,
  CollabMessage,
  CollabRequirementCounts,
  CollabRequirementSnapshot,
  CollabRequirementSummary,
  CollabTask,
} from "../../types/collaboration";

/** 当前计划下仍生效的任务（被新计划取代的不展示在主视图）。 */
export function liveTasks(tasks: readonly CollabTask[]): CollabTask[] {
  return tasks.filter((t) => t.active && !t.supersededBy);
}

export interface RepositoryTaskGroup {
  repositoryId: number | null;
  projectId: string | null;
  tasks: CollabTask[];
  succeeded: number;
  running: number;
  blocked: number;
}

const BLOCKED_STATES = new Set(["waiting_change", "failed"]);

/** 按仓库分组；无仓库的规划任务单独一组置于最前。 */
export function groupTasksByRepository(tasks: readonly CollabTask[]): RepositoryTaskGroup[] {
  const groups = new Map<string, RepositoryTaskGroup>();
  for (const task of liveTasks(tasks)) {
    const key = task.repositoryId == null ? "none" : String(task.repositoryId);
    let group = groups.get(key);
    if (!group) {
      group = {
        repositoryId: task.repositoryId,
        projectId: task.projectId,
        tasks: [],
        succeeded: 0,
        running: 0,
        blocked: 0,
      };
      groups.set(key, group);
    }
    group.tasks.push(task);
    if (task.state === "succeeded") group.succeeded += 1;
    if (task.state === "running" || task.state === "checking") group.running += 1;
    if (BLOCKED_STATES.has(task.state)) group.blocked += 1;
  }
  for (const group of groups.values()) {
    group.tasks.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.repositoryId == null) return -1;
    if (b.repositoryId == null) return 1;
    return a.repositoryId - b.repositoryId;
  });
}

/** 已完成任务占比（0–100，整数）。 */
export function requirementProgress(counts: Pick<CollabRequirementCounts, "tasks" | "byState">): number {
  if (!counts.tasks) return 0;
  const done = (counts.byState.succeeded ?? 0) + (counts.byState.cancelled ?? 0);
  return Math.min(100, Math.round((done / counts.tasks) * 100));
}

export function openDecisions(decisions: readonly CollabDecision[]): CollabDecision[] {
  return decisions.filter((d) => d.state === "open").sort((a, b) => a.createdAt - b.createdAt);
}

export function openChanges(changes: readonly CollabChangeRequest[]): CollabChangeRequest[] {
  return changes.filter((c) => !c.mergedInto && !["verified", "closed", "rejected"].includes(c.state));
}

/** 每个产物只保留最新版本，按名称排序。 */
export function latestArtifactVersions(versions: readonly CollabArtifactVersion[]): CollabArtifactVersion[] {
  const latest = new Map<string, CollabArtifactVersion>();
  for (const v of versions) {
    const cur = latest.get(v.artifactId);
    if (!cur || v.version > cur.version) latest.set(v.artifactId, v);
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** 需求列表排序：需要人处理的在前，其次进行中，最后已完成/取消；同组按更新时间倒序。 */
export function sortRequirementSummaries(list: readonly CollabRequirementSummary[]): CollabRequirementSummary[] {
  const rank = (r: CollabRequirementSummary): number => {
    if (r.controlStatus === "cancelled" || r.businessStatus === "done") return 3;
    if (r.counts.openDecisions > 0 || r.businessStatus === "verifying") return 0;
    if (r.controlStatus !== "active") return 2;
    return 1;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  "requirement.revised": "需求修订",
  "requirement.stop_pending": "停止待确认",
  "requirement.verifying": "进入验收",
  "requirement.done": "需求完成",
  "plan.rejected": "计划被拒",
  "task.planned": "任务已规划",
  "task.assigned": "任务分派",
  "task.succeeded": "任务完成",
  "task.failed": "任务失败",
  "artifact.ready": "产物可用",
  "artifact.invalid": "产物失效",
  "change.requested": "修正单",
  "change.ready_for_retest": "待复测",
  "change.retest_failed": "复测失败",
  "change.verified": "修正已验证",
  "change.released": "修正已释放",
  "change.dispute_rejected": "驳回被否决",
  "decision.required": "待决策",
  "acceptance.rejected": "验收退回",
  "owner.transferred": "主责移交",
  "resource.revoked": "资源撤销",
};

export function messageTypeLabel(type: string): string {
  return MESSAGE_TYPE_LABELS[type] ?? type;
}

/** 从消息体提取一行摘要；只读取字符串字段，避免渲染不可信结构。 */
export function messageSummary(message: Pick<CollabMessage, "body" | "type">): string {
  const body = message.body ?? {};
  for (const key of ["summary", "text", "message", "title", "reason", "body"]) {
    const v = (body as Record<string, unknown>)[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 240);
  }
  return messageTypeLabel(message.type);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export interface CollabPlanView {
  revision: number;
  state: string;
  summary: string;
  rationale: string;
}

/** 生效计划（无则最新提议）的摘要与判断依据；只取字符串字段。 */
export function currentPlanView(
  snapshot: Pick<CollabRequirementSnapshot, "plans" | "requirement">,
): CollabPlanView | null {
  const plans = snapshot.plans
    .map((p) => asRecord(p))
    .filter((p): p is Record<string, unknown> => p != null && typeof p.revision === "number");
  if (!plans.length) return null;
  const active = plans.find((p) => p.revision === snapshot.requirement.activePlanRevision && p.state === "active");
  const chosen = active ?? [...plans].sort((a, b) => (b.revision as number) - (a.revision as number))[0]!;
  const plan = asRecord(chosen.plan);
  const summary = typeof plan?.summary === "string" ? plan.summary.trim() : "";
  const rationaleRaw = chosen.rationale ?? plan?.rationale;
  const rationaleRec = asRecord(rationaleRaw);
  const rationale =
    typeof rationaleRaw === "string"
      ? rationaleRaw.trim()
      : typeof rationaleRec?.summary === "string"
        ? rationaleRec.summary.trim()
        : typeof rationaleRec?.judgement === "string"
          ? rationaleRec.judgement.trim()
          : "";
  return {
    revision: chosen.revision as number,
    state: typeof chosen.state === "string" ? chosen.state : "",
    summary,
    rationale,
  };
}

/** 待用户“开始执行”的计划审批 / 范围扩展决策。 */
export function pendingPlanDecision(decisions: readonly CollabDecision[]): CollabDecision | null {
  return (
    openDecisions(decisions).find((d) => d.kind === "plan_approval" || d.kind === "scope_expansion") ?? null
  );
}

/** 计划链：按依赖拓扑顺序（近似：优先级与创建时间）列出生效任务标题。 */
export function planChain(tasks: readonly CollabTask[], max = 5): string {
  const live = liveTasks(tasks).filter((t) => t.kind !== "plan");
  const titles = [...live]
    .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)
    .map((t) => t.title);
  if (!titles.length) return "";
  return titles.length > max ? `${titles.slice(0, max).join(" → ")} → …` : titles.join(" → ");
}

/** 用户可见的阻塞原因：取需要决策者优先。 */
export function topBlockers(snapshot: Pick<CollabRequirementSnapshot, "explanation">, limit = 5) {
  const all = snapshot.explanation.flatMap((e) =>
    e.blockers.map((b) => ({ ...b, taskId: e.taskId, taskTitle: e.title })),
  );
  return all.sort((a, b) => Number(b.needsDecision) - Number(a.needsDecision)).slice(0, limit);
}
