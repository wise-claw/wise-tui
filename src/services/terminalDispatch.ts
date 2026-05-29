import { message } from "antd";
import type { ClaudeMessage, ClaudeSession, EmployeeItem, Repository } from "../types";
import { extractBoundEmployeeNameFromSessionRepositoryName } from "./workflowGraphHelpers";
import { isOmcMonitorEmployeeRecord } from "../utils/omcMonitorEmployeeSession";
import {
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey,
  repositoryPathsMatch,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";
import { notificationHub } from "../notifications";

/** 终端派发名称规范化：`终端01` 与 `终端1` 视为同一终端。 */
export function normalizeTerminalDispatchName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return trimmed;
  const prefix = match[1] ?? "";
  const digits = match[2] ?? "";
  const parsed = Number.parseInt(digits, 10);
  if (!Number.isFinite(parsed)) return trimmed;
  return `${prefix}${parsed}`;
}

export function isAtMentionBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1];
  return /[\s([{「『【，,;；：:]/.test(prev);
}

export function findTerminalMentionIndex(prompt: string, terminalName: string): number {
  const name = terminalName.trim();
  if (!name) return -1;
  const matches: number[] = [];
  const prefixes = ["@", "＠"];
  for (const prefix of prefixes) {
    let from = 0;
    while (from < prompt.length) {
      const idx = prompt.indexOf(`${prefix}${name}`, from);
      if (idx < 0) break;
      if (!isAtMentionBoundary(prompt, idx)) {
        from = idx + 1;
        continue;
      }
      const tail = prompt[idx + prefix.length + name.length] ?? "";
      if (!tail || !/[\p{L}\p{N}_-]/u.test(tail)) {
        matches.push(idx);
      }
      from = idx + prefix.length + name.length;
    }
  }
  if (matches.length === 0) return -1;
  return Math.min(...matches);
}

export function findTerminalEmployeeByName(
  employees: EmployeeItem[],
  rawName: string,
): EmployeeItem | undefined {
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;
  const exact = employees.find((item) => item.name.trim() === trimmed);
  if (exact) return exact;
  const normalized = normalizeTerminalDispatchName(trimmed);
  return employees.find(
    (item) => normalizeTerminalDispatchName(item.name) === normalized,
  );
}

export function resolveTerminalMentionsInPrompt(
  prompt: string,
  employees: EmployeeItem[],
): EmployeeItem[] {
  return employees
    .filter((employee) => !isOmcMonitorEmployeeRecord(employee))
    .map((employee) => ({
      employee,
      mentionIndex: findTerminalMentionIndex(prompt, employee.name),
    }))
    .filter((entry) => entry.mentionIndex >= 0)
    .sort((left, right) => {
      if (left.mentionIndex !== right.mentionIndex) {
        return left.mentionIndex - right.mentionIndex;
      }
      return right.employee.name.trim().length - left.employee.name.trim().length;
    })
    .map((entry) => entry.employee);
}

/** 去掉终端派发误注入的 `/${agent}` 行（不再作为 Claude 斜杠命令发送）。 */
export function stripTerminalAgentSlashPrefix(
  prompt: string,
  agentType: string | null | undefined,
): string {
  let text = prompt.trim();
  const agent = agentType?.trim();
  if (agent) {
    const escaped = agent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const specific = new RegExp(`^/${escaped}(?:\\s*\\n|\\s+|$)`);
    text = text.replace(specific, "").trimStart();
  }
  // 兜底：首行形如 `/executor` 的斜杠命令（非用户真实 slash 指令）
  text = text.replace(/^\/[\w-]+(?:\s*\n|\s+)/, "").trimStart();
  return text;
}

/** @deprecated 终端不再向 prompt 注入 `/${agent}`；保留函数名供调用方复用 strip 逻辑。 */
export function buildTerminalExecutionPrompt(
  prompt: string,
  agentType: string | null | undefined,
): string {
  return stripTerminalAgentSlashPrefix(prompt, agentType);
}

/** 终端 worker 会话气泡：与发给 Claude 的正文一致（均不含智能体斜杠前缀）。 */
export function buildTerminalUserBubblePrompt(
  prompt: string,
  agentType: string | null | undefined,
): string {
  return stripTerminalAgentSlashPrefix(prompt, agentType);
}

export function resolveTerminalDispatchPrompts(
  prompt: string,
  agentType: string | null | undefined,
): { outboundPrompt: string; userBubblePrompt: string } {
  const cleaned = stripTerminalAgentSlashPrefix(prompt, agentType);
  return {
    outboundPrompt: cleaned,
    userBubblePrompt: cleaned,
  };
}

/** 从磁盘 jsonl 灌回的终端 worker 用户消息：去掉历史误注入的 `/${agent}` 行。 */
export function sanitizeTerminalWorkerTranscriptMessages(
  messages: ClaudeMessage[],
  agentType?: string | null,
): ClaudeMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const text = typeof message.content === "string" ? message.content : "";
    if (!text.trim()) return message;
    const cleaned = stripTerminalAgentSlashPrefix(text, agentType);
    if (cleaned === text) return message;
    return { ...message, content: cleaned };
  });
}

export function formatTerminalDispatchRecord(
  terminalName: string,
  workerTabId: string,
): string {
  return [
    "任务分发记录",
    `- 类型：终端独立会话`,
    `- 目标：${terminalName}`,
    `- 分发会话：${workerTabId}`,
    `- 时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
  ].join("\n");
}

/** 终端 worker 标签（`repositoryName` 含 `员工:`）保留 Wise tab id，仅更新 `claudeSessionId`。 */
export function isTerminalWorkerWiseTab(
  session: Pick<ClaudeSession, "repositoryName">,
): boolean {
  return extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName) != null;
}

/** 磁盘索引合并产生的空壳：id 与 claudeSessionId 相同且无消息，不可复用。 */
export function isDiskOnlyTerminalWorkerTab(session: ClaudeSession): boolean {
  if (!isTerminalWorkerWiseTab(session)) return false;
  if (session.messages.length > 0) return false;
  if (session.status === "running" || session.status === "connecting") return false;
  const cid = session.claudeSessionId?.trim();
  return Boolean(cid && session.id === cid);
}

export function findTerminalWorkerTab(
  sessions: ClaudeSession[],
  repositoryPath: string,
  terminalName: string,
): ClaudeSession | undefined {
  const repo = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const target = normalizeTerminalDispatchName(terminalName);
  return sessions.find((session) => {
    if (!repositoryPathsMatch(session.repositoryPath, repo)) return false;
    const bound = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
    if (!bound || normalizeTerminalDispatchName(bound) !== target) return false;
    return !isDiskOnlyTerminalWorkerTab(session);
  });
}

function repositoryDisplayBase(repositoryName: string): string {
  const marker = "/员工:";
  const idx = repositoryName.indexOf(marker);
  if (idx >= 0) return repositoryName.slice(0, idx).trim() || repositoryName;
  return repositoryName.trim();
}

export type TerminalDispatchDeps = {
  getSessions: () => ClaudeSession[];
  employees: EmployeeItem[];
  repositories: Repository[];
  repositoryMainSessionBindings: Record<string, string>;
  createSession: (
    repositoryPath: string,
    repositoryName: string,
    opts?: { skipActivate?: boolean; connectionKind?: "oneshot" | "streaming" },
  ) => Promise<string>;
  executeTerminalSession: (
    workerTabId: string,
    outboundPrompt: string,
    opts?: { userBubblePrompt?: string },
  ) => boolean;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /** 关闭磁盘空壳标签，避免同一终端堆积多个无效 tab。 */
  closeWorkerTab?: (tabId: string) => void;
  /**
   * 派发成功后的可选回调（默认不切换中栏主会话；终端在后台执行，运行态见侧栏运行面板）。
   */
  onDispatched?: (workerTabId: string) => void;
};

export async function resolveOrCreateTerminalWorkerTab(
  deps: Pick<TerminalDispatchDeps, "getSessions" | "createSession" | "closeWorkerTab">,
  repositoryPath: string,
  repositoryDisplayName: string,
  terminal: EmployeeItem,
): Promise<{ workerTabId: string; created: boolean }> {
  const repo = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const target = normalizeTerminalDispatchName(terminal.name);
  for (const session of deps.getSessions()) {
    if (!repositoryPathsMatch(session.repositoryPath, repo)) continue;
    const bound = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
    if (!bound || normalizeTerminalDispatchName(bound) !== target) continue;
    if (isDiskOnlyTerminalWorkerTab(session)) {
      deps.closeWorkerTab?.(session.id);
    }
  }

  const existing = findTerminalWorkerTab(deps.getSessions(), repositoryPath, terminal.name);
  if (existing) {
    return { workerTabId: existing.id, created: false };
  }
  const base = repositoryDisplayBase(repositoryDisplayName);
  const workerTabId = await deps.createSession(
    repositoryPath,
    `${base}/员工:${terminal.name}`,
    { skipActivate: true, connectionKind: "oneshot" },
  );
  return { workerTabId, created: true };
}

async function waitForTerminalTurnStarted(
  getSessions: () => ClaudeSession[],
  workerTabId: string,
  maxFrames = 40,
): Promise<boolean> {
  const key = workerTabId.trim();
  if (!key) return false;
  for (let i = 0; i < maxFrames; i += 1) {
    const worker = getSessions().find((item) => item.id === key);
    if (
      worker &&
      worker.messages.some((item) => item.role === "user") &&
      (worker.status === "running" || worker.status === "connecting")
    ) {
      return true;
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  const worker = getSessions().find((item) => item.id === key);
  return Boolean(
    worker &&
      worker.messages.some((item) => item.role === "user") &&
      (worker.status === "running" || worker.status === "connecting"),
  );
}

function mirrorTerminalToControlDock(
  deps: TerminalDispatchDeps,
  workerTabId: string,
  mainSessionId: string,
): void {
  const worker = deps.getSessions().find((item) => item.id === workerTabId);
  if (!worker || !isTerminalWorkerWiseTab(worker)) return;

  const pathKey = normalizeRepositoryPathKey(worker.repositoryPath);
  const mainOwner = resolveMainOwnerAgentNameForRepositoryPath(
    deps.repositories,
    worker.repositoryPath,
  );
  let viewer =
    resolveBoundMainSessionId(
      worker.repositoryPath,
      deps.repositoryMainSessionBindings,
      deps.getSessions(),
      mainOwner,
    ) ?? null;
  if (!viewer || viewer === workerTabId) {
    const fallback = deps.getSessions().find(
      (session) =>
        isRepositoryMainSessionTab(session, pathKey, mainOwner) &&
        session.id !== workerTabId,
    );
    viewer = fallback?.id ?? null;
  }
  if (!viewer || viewer === workerTabId) {
    if (mainSessionId !== workerTabId) {
      viewer = mainSessionId;
    } else {
      return;
    }
  }
  notificationHub.setControlDockMirror(viewer, workerTabId);
}

/**
 * @终端 → 终端 worker 标签：解析目标、创建/复用 Wise 标签、强制新 Claude 回合执行。
 */
export async function dispatchTerminalFromMainSession(
  deps: TerminalDispatchDeps,
  input: {
    mainSessionId: string;
    prompt: string;
    explicitTerminalName?: string;
  },
): Promise<"not_terminal" | "failed" | "ok"> {
  const mainSession = deps.getSessions().find((item) => item.id === input.mainSessionId);
  if (!mainSession) return "not_terminal";

  const explicitName = input.explicitTerminalName?.trim();
  const mentioned = resolveTerminalMentionsInPrompt(input.prompt, deps.employees);
  const terminal =
    (explicitName ? findTerminalEmployeeByName(deps.employees, explicitName) : undefined) ??
    mentioned[0];

  if (!terminal) {
    if (explicitName) {
      const warningText = `未找到终端「${explicitName}」，请检查终端名称后重试。`;
      message.warning(warningText);
      deps.appendSystemMessage(input.mainSessionId, warningText);
      return "failed";
    }
    return "not_terminal";
  }

  const { outboundPrompt, userBubblePrompt } = resolveTerminalDispatchPrompts(
    input.prompt,
    terminal.agentType,
  );
  if (!userBubblePrompt.trim()) {
    const warningText = `终端「${terminal.name}」未收到可执行内容，请补充任务说明后重试。`;
    message.warning(warningText);
    deps.appendSystemMessage(input.mainSessionId, warningText);
    return "failed";
  }

  const { workerTabId, created } = await resolveOrCreateTerminalWorkerTab(
    deps,
    mainSession.repositoryPath,
    mainSession.repositoryName,
    terminal,
  );

  if (created) {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }

  const spawnOk = deps.executeTerminalSession(workerTabId, outboundPrompt, {
    userBubblePrompt,
  });
  if (!spawnOk) {
    const failureText = `任务分发失败：终端「${terminal.name}」未能启动 Claude Code（请检查并发上限或网络）。`;
    message.warning(failureText);
    deps.appendSystemMessage(input.mainSessionId, failureText);
    return "failed";
  }

  const started = await waitForTerminalTurnStarted(deps.getSessions, workerTabId);
  if (!started) {
    const failureText = `任务分发失败：终端「${terminal.name}」未进入执行态（请勿点击仅有 UUID 的空历史会话，请重试派发）。`;
    message.warning(failureText);
    deps.appendSystemMessage(input.mainSessionId, failureText);
    return "failed";
  }

  deps.appendSystemMessage(
    input.mainSessionId,
    formatTerminalDispatchRecord(terminal.name, workerTabId),
  );
  mirrorTerminalToControlDock(deps, workerTabId, input.mainSessionId);
  deps.onDispatched?.(workerTabId);
  return "ok";
}
