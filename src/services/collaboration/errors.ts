import type { CollabError } from "../../types/collaboration";

const CODE_LABELS: Record<string, string> = {
  AMBIGUOUS_TARGET: "目标不明确",
  REVISION_CONFLICT: "数据已更新",
  AGENT_DISABLED: "智能体未启用",
  REQUIRED_CAPABILITY_MISSING: "能力不满足",
  DEPENDENCY_NOT_READY: "依赖未就绪",
  STOP_PENDING: "正在停止",
  BUDGET_EXHAUSTED: "预算已用尽",
  STALE_ACCEPTANCE: "验收清单已过期",
  NOT_FOUND: "未找到",
  INVALID_PAYLOAD: "参数无效",
  INVALID_PLAN: "计划无效",
  INVALID_CHANGE_PAYLOAD: "问题描述不完整",
  SCOPE_NOT_AUTHORIZED: "超出授权范围",
  STALE_ATTEMPT: "尝试已过期",
  STALE_ROUND: "修复轮次已过期",
  REQUEST_ID_REUSED: "请求号已被使用",
  REQUIREMENT_CANCELLED: "需求已取消",
  INVALID_STATE: "状态不允许",
  FORBIDDEN: "无权限",
  STORAGE_ERROR: "存储错误",
  IO_ERROR: "执行错误",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Tauri 命令拒绝值 → 结构化错误；兼容字符串与 Error。 */
export function normalizeCollabError(err: unknown): CollabError {
  if (isRecord(err) && typeof err.code === "string" && typeof err.message === "string") {
    return {
      code: err.code,
      message: err.message,
      retryable: err.retryable === true,
      currentRevision: typeof err.currentRevision === "number" ? err.currentRevision : undefined,
      affectedTaskIds: Array.isArray(err.affectedTaskIds)
        ? err.affectedTaskIds.filter((x): x is string => typeof x === "string")
        : [],
      suggestedAction: typeof err.suggestedAction === "string" ? err.suggestedAction : undefined,
      details: err.details,
    };
  }
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "未知错误";
  const m = /^\[([A-Z_]+)\]\s*(.*)$/s.exec(message);
  return {
    code: m?.[1] ?? "UNKNOWN",
    message: m?.[2] ?? message,
    retryable: false,
    affectedTaskIds: [],
  };
}

export function collabErrorLabel(code: string): string {
  return CODE_LABELS[code] ?? "操作失败";
}

/** 面向用户的一行错误文本。 */
export function formatCollabError(err: unknown): string {
  const e = normalizeCollabError(err);
  const label = collabErrorLabel(e.code);
  return e.message ? `${label}：${e.message}` : label;
}

export function isCollabErrorCode(err: unknown, code: string): boolean {
  return normalizeCollabError(err).code === code;
}
