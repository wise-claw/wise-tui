import type { FeedbackConfigPatch } from "./sessionFeedbackConfigPatch";
import { feedbackPatchDedupeKey } from "./feedbackAutomationGuard";

/**
 * 反馈神经网自动化审计日志（可观测遥测）。
 *
 * 记录自动 apply / rollback / verify 与护栏拦截、熔断等决策，供用户事后追溯
 * 「为什么这条补丁被自动应用 / 回滚 / 拦截」。属运行时遥测而非核心项目/工作流/
 * 会话元数据，沿用现有 effectiveness 模块的 localStorage 兼容路径（与 DB 持久化
 * 的 effectiveness 数据互补：effectiveness 记「补丁效果」，审计记「自动化决策」）。
 */

const STORAGE_KEY = "wise.sessionFeedbackLoop.automationAudit.v1";
const MAX_ENTRIES = 200;

export type FeedbackAutomationAuditAction =
  | "auto_apply"
  | "auto_rollback"
  | "auto_verify"
  | "guard_block"
  | "circuit_breaker"
  | "circuit_reset";

export type FeedbackAutomationAuditOutcome = "success" | "skipped" | "failed";

export interface FeedbackAutomationAuditEntry {
  id: string;
  at: number;
  repositoryPath: string;
  action: FeedbackAutomationAuditAction;
  patchId?: string;
  patchKey?: string;
  reason: string;
  outcome: FeedbackAutomationAuditOutcome;
  detail?: string;
}

function readStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
      return globalThis.localStorage as Storage;
    }
  } catch {
    /* ignore */
  }
  return null;
}

let auditCache: FeedbackAutomationAuditEntry[] | null = null;

export function loadAllFeedbackAutomationAudit(): FeedbackAutomationAuditEntry[] {
  if (auditCache) return auditCache;
  const storage = readStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw?.trim()) return [];
    const parsed = JSON.parse(raw) as FeedbackAutomationAuditEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(entries: FeedbackAutomationAuditEntry[]): void {
  const storage = readStorage();
  auditCache = entries.slice(0, MAX_ENTRIES);
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(auditCache));
  } catch {
    /* quota */
  }
}

/** 追加一条审计记录。patch 提供时自动派生 patchId / patchKey。 */
export function appendFeedbackAutomationAudit(input: {
  repositoryPath: string;
  action: FeedbackAutomationAuditAction;
  reason: string;
  outcome?: FeedbackAutomationAuditOutcome;
  patch?: FeedbackConfigPatch;
  patchId?: string;
  detail?: string;
}): FeedbackAutomationAuditEntry {
  const patchKey = input.patch ? feedbackPatchDedupeKey(input.patch) : undefined;
  const entry: FeedbackAutomationAuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    repositoryPath: input.repositoryPath.trim(),
    action: input.action,
    patchId: input.patch?.id ?? input.patchId,
    patchKey,
    reason: input.reason,
    outcome: input.outcome ?? "success",
    detail: input.detail,
  };
  const next = [entry, ...loadAllFeedbackAutomationAudit()];
  saveAll(next);
  return entry;
}

export function listFeedbackAutomationAudit(
  repositoryPath?: string | null,
  limit = 50,
): FeedbackAutomationAuditEntry[] {
  const repo = repositoryPath?.trim();
  const all = loadAllFeedbackAutomationAudit();
  const filtered = repo ? all.filter((e) => e.repositoryPath === repo) : all;
  return filtered.slice(0, limit);
}

export function clearFeedbackAutomationAudit(repositoryPath?: string | null): void {
  if (!repositoryPath?.trim()) {
    saveAll([]);
    return;
  }
  const repo = repositoryPath.trim();
  const next = loadAllFeedbackAutomationAudit().filter((e) => e.repositoryPath !== repo);
  saveAll(next);
}

const ACTION_LABEL: Record<FeedbackAutomationAuditAction, string> = {
  auto_apply: "自动应用",
  auto_rollback: "自动回滚",
  auto_verify: "自动验证",
  guard_block: "护栏拦截",
  circuit_breaker: "熔断",
  circuit_reset: "熔断重置",
};

const OUTCOME_LABEL: Record<FeedbackAutomationAuditOutcome, string> = {
  success: "",
  skipped: " [跳过]",
  failed: " [失败]",
};

export function formatFeedbackAutomationAuditEntry(entry: FeedbackAutomationAuditEntry): string {
  const time = new Date(entry.at).toLocaleTimeString();
  const label = ACTION_LABEL[entry.action] ?? entry.action;
  const outcome = OUTCOME_LABEL[entry.outcome] ?? "";
  const patch = entry.patchKey ? ` · ${entry.patchKey}` : "";
  return `${time} ${label}${outcome}${patch}：${entry.reason}`;
}

export function formatFeedbackAutomationAuditSummary(
  entries: readonly FeedbackAutomationAuditEntry[],
  limit = 8,
): string {
  if (entries.length === 0) return "暂无自动化审计记录";
  return entries.slice(0, limit).map(formatFeedbackAutomationAuditEntry).join("\n");
}

/** 触发模块级缓存失效（测试用，确保读取最新 localStorage）。 */
export function __resetFeedbackAutomationAuditCacheForTest(): void {
  auditCache = null;
}
