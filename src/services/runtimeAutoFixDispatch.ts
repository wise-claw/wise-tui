import { message } from "antd";
import type { ClaudeSession } from "../types";
import { upsertExecutionEnvironmentDispatchItem } from "../stores/executionEnvironmentDispatchStore";

export type RuntimeAutoFixSource = "page-monitor" | "run-command";

export type RuntimeAutoFixDispatchDeps = {
  getSessions: () => ClaudeSession[];
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  /** 直接在 worker 会话执行，不经团队/主会话路由，且不切换主窗口。 */
  executeSession: (workerTabId: string, prompt: string) => boolean;
};

export type RuntimeAutoFixDispatchInput = {
  anchorSessionId: string;
  prompt: string;
  source: RuntimeAutoFixSource;
  /** 页面监控 sessionId（仓库 id 字符串）；完成后据此刷新监控页。 */
  pageMonitorSessionId?: string;
};

export type PendingPageMonitorReload = {
  workerSessionId: string;
  pageMonitorSessionId: string;
  registeredAt: number;
  /** True once worker has been connecting/running — avoids treating pre-spawn idle as done. */
  seenActive: boolean;
};

const pendingPageMonitorReloads = new Map<string, PendingPageMonitorReload>();

function repositoryDisplayBase(repositoryName: string): string {
  let name = repositoryName.trim();
  for (const marker of ["/神经网:", "/执行环境:", "/员工:", "/页面监控:"]) {
    const idx = name.indexOf(marker);
    if (idx >= 0) name = name.slice(0, idx).trim();
  }
  return name || repositoryName.trim() || "仓库";
}

function sourceLabel(source: RuntimeAutoFixSource): string {
  return source === "page-monitor" ? "页面监控·自动修复" : "运行监控·自动修复";
}

function buildWorkerRepositoryName(displayBase: string, source: RuntimeAutoFixSource): string {
  const stamp = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${displayBase}/执行环境:${sourceLabel(source)}·${stamp}`;
}

function isActiveStatus(status: ClaudeSession["status"]): boolean {
  return status === "connecting" || status === "running";
}

function isTerminalStatus(status: ClaudeSession["status"]): boolean {
  return status === "idle" || status === "error" || status === "completed" || status === "cancelled";
}

export function registerPageMonitorReloadOnWorkerComplete(input: {
  workerSessionId: string;
  pageMonitorSessionId: string;
}): void {
  const workerSessionId = input.workerSessionId.trim();
  const pageMonitorSessionId = input.pageMonitorSessionId.trim();
  if (!workerSessionId || !pageMonitorSessionId) return;
  pendingPageMonitorReloads.set(workerSessionId, {
    workerSessionId,
    pageMonitorSessionId,
    registeredAt: Date.now(),
    seenActive: false,
  });
}

/**
 * Scan sessions for completed page-monitor auto-fix workers.
 * Returns pageMonitorSessionIds that should be reloaded (each at most once).
 */
export function consumeCompletedPageMonitorReloads(
  sessions: readonly ClaudeSession[],
): string[] {
  if (pendingPageMonitorReloads.size === 0) return [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const out: string[] = [];
  const seenMonitor = new Set<string>();
  for (const [workerId, pending] of [...pendingPageMonitorReloads.entries()]) {
    const worker = byId.get(workerId);
    if (!worker) continue;
    if (isActiveStatus(worker.status)) {
      pending.seenActive = true;
      continue;
    }
    if (!isTerminalStatus(worker.status)) continue;
    if (!pending.seenActive) {
      // Grace window for spawn to leave idle → connecting.
      if (Date.now() - pending.registeredAt < 3000) continue;
    }
    pendingPageMonitorReloads.delete(workerId);
    if (worker.status === "error" || worker.status === "cancelled") continue;
    if (seenMonitor.has(pending.pageMonitorSessionId)) continue;
    seenMonitor.add(pending.pageMonitorSessionId);
    out.push(pending.pageMonitorSessionId);
  }
  return out;
}

/** @internal */
export function resetPendingPageMonitorReloadsForTests(): void {
  pendingPageMonitorReloads.clear();
}

/**
 * 将自动修复任务指派到独立 oneshot worker 会话：
 * - 不切换主会话
 * - 不在主会话窗口展示气泡
 * - 在执行环境派发列表可见
 */
export async function dispatchRuntimeAutoFix(
  deps: RuntimeAutoFixDispatchDeps,
  input: RuntimeAutoFixDispatchInput,
): Promise<boolean> {
  const prompt = input.prompt.trim();
  if (!prompt) {
    message.warning("自动修复派发正文为空");
    return false;
  }

  const anchorSession = deps.getSessions().find((item) => item.id === input.anchorSessionId);
  if (!anchorSession) {
    message.warning("未找到主会话，无法指派自动修复");
    return false;
  }

  const displayBase = repositoryDisplayBase(anchorSession.repositoryName);
  const label = sourceLabel(input.source);
  const workerName = buildWorkerRepositoryName(displayBase, input.source);
  const preview = prompt.split("\n").find((line) => line.trim())?.trim() ?? prompt;
  const previewText = preview.length > 72 ? `${preview.slice(0, 69)}…` : preview;

  const workerTabId = await deps.createSession(anchorSession.repositoryPath, workerName, {
    skipActivate: true,
    connectionKind: "oneshot",
  });

  const spawnOk = deps.executeSession(workerTabId, prompt);
  if (spawnOk === false) {
    message.warning("自动修复指派未启动：可能已达并发上限，请稍后重试。");
    return false;
  }

  upsertExecutionEnvironmentDispatchItem({
    batchId: `runtime-auto-fix:${input.source}:${workerTabId}`,
    anchorSessionId: anchorSession.id,
    workerSessionId: workerTabId,
    label,
    previewText,
    batchIndex: 1,
    sessionCount: 1,
  });

  if (input.source === "page-monitor" && input.pageMonitorSessionId?.trim()) {
    registerPageMonitorReloadOnWorkerComplete({
      workerSessionId: workerTabId,
      pageMonitorSessionId: input.pageMonitorSessionId.trim(),
    });
  }

  message.success(`已指派「${label}」至独立会话（不占用主窗口）`);
  return true;
}
