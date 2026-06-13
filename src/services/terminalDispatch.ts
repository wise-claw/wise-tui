import { message } from "antd";
import type { ClaudeMessage, ClaudeSession, EmployeeItem, Repository } from "../types";
import { loadComposerDefaultInstructionFromStore } from "./wiseDefaultConfigStore";
import {
  resolveTerminalTaskPromptWithDefaults,
  resolveTerminalDefaultInstructionApplied,
} from "../utils/resolveTerminalTaskPrompt";
import { loadDefaultInstructionResolveContext } from "../utils/resolveComposerDefaultInstructionOutbound";
import {
  SESSION_EXECUTION_ENGINE_LABELS,
  normalizeSessionExecutionEngine,
} from "../constants/sessionExecutionEngine";
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
import { normalizeEmployeeBindingName } from "../utils/employeeBindingName";

/** 终端派发名称规范化：`终端01` 与 `终端1` 视为同一终端。 */
export function normalizeTerminalDispatchName(name: string): string {
  return normalizeEmployeeBindingName(name);
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

/** 从派发正文中移除所有 @终端 提及，保留可执行任务说明。 */
export function stripTerminalMentionsFromPrompt(
  prompt: string,
  employees: EmployeeItem[],
): string {
  let text = prompt;
  let changed = true;
  while (changed) {
    changed = false;
    for (const employee of employees) {
      if (isOmcMonitorEmployeeRecord(employee)) continue;
      const idx = findTerminalMentionIndex(text, employee.name);
      if (idx < 0) continue;
      const prefix = text[idx] === "＠" ? "＠" : "@";
      const name = employee.name.trim();
      text = `${text.slice(0, idx)}${text.slice(idx + prefix.length + name.length)}`;
      changed = true;
    }
    text = text.replace(/\s{2,}/g, " ").trim();
  }
  return text;
}

function dedupeTerminalEmployees(employees: EmployeeItem[]): EmployeeItem[] {
  const seen = new Set<string>();
  const out: EmployeeItem[] = [];
  for (const employee of employees) {
    const key = employee.id.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(employee);
  }
  return out;
}

/** 去掉终端派发历史误注入的 `/${agent}` 前缀；保留用户真实 slash 指令（如 `/add-dir`）。 */
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
  opts?: { stripMentionEmployees?: EmployeeItem[] },
): { outboundPrompt: string; userBubblePrompt: string } {
  const withoutMentions =
    opts?.stripMentionEmployees && opts.stripMentionEmployees.length > 0
      ? stripTerminalMentionsFromPrompt(prompt, opts.stripMentionEmployees)
      : prompt;
  const cleaned = stripTerminalAgentSlashPrefix(withoutMentions, agentType);
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

function formatTerminalDispatchRecordTime(date: Date): string {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function normalizeTerminalDispatchRecordContent(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed || "（无正文）";
}

export function formatTerminalDispatchRecord(
  terminalName: string,
  workerTabId: string,
  dispatchContent: string,
  executionEngine?: EmployeeItem["executionEngine"],
  dispatchedAt: Date = new Date(),
): string {
  const engineLabel =
    SESSION_EXECUTION_ENGINE_LABELS[
      normalizeSessionExecutionEngine(executionEngine)
    ].short;
  const content = normalizeTerminalDispatchRecordContent(dispatchContent);
  return [
    "任务分发记录",
    `- 类型：终端独立会话`,
    `- 目标：${terminalName}`,
    `- 时间：${formatTerminalDispatchRecordTime(dispatchedAt)}`,
    `- 正文：${content}`,
    `- 分发会话：${workerTabId}`,
    `- 执行引擎：${engineLabel}`,
  ].join("\n");
}

function terminalExecutionEngineTitle(terminal: EmployeeItem): string {
  return SESSION_EXECUTION_ENGINE_LABELS[
    normalizeSessionExecutionEngine(terminal.executionEngine)
  ].title;
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

function terminalWorkerSessionSortKey(session: ClaudeSession): number {
  const last = session.messages[session.messages.length - 1]?.timestamp;
  return typeof last === "number" ? last : session.createdAt;
}

function terminalWorkerScopeKey(repositoryPath: string, terminalName: string): string {
  const repo = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  return `${repo}\x1f${normalizeTerminalDispatchName(terminalName)}`;
}

/** 运行面板「新建会话」后，@终端 派发优先命中此 worker，直至再次新建或标签关闭。 */
const terminalDefaultWorkerTabByScope = new Map<string, string>();

export function setTerminalDefaultWorkerTab(
  repositoryPath: string,
  terminalName: string,
  workerTabId: string,
): void {
  const id = workerTabId.trim();
  const key = terminalWorkerScopeKey(repositoryPath, terminalName);
  if (!id) {
    terminalDefaultWorkerTabByScope.delete(key);
    return;
  }
  terminalDefaultWorkerTabByScope.set(key, id);
}

export function clearTerminalDefaultWorkerTabIfMatch(workerTabId: string): void {
  const id = workerTabId.trim();
  if (!id) return;
  for (const [key, pinned] of terminalDefaultWorkerTabByScope) {
    if (pinned === id) {
      terminalDefaultWorkerTabByScope.delete(key);
    }
  }
}

/** @internal */
export function resetTerminalDefaultWorkerTabsForTests(): void {
  terminalDefaultWorkerTabByScope.clear();
}

function resolvePinnedTerminalWorkerTab(
  matches: ClaudeSession[],
  repositoryPath: string,
  terminalName: string,
): ClaudeSession | undefined {
  const pinnedId = terminalDefaultWorkerTabByScope.get(
    terminalWorkerScopeKey(repositoryPath, terminalName),
  );
  if (!pinnedId) return undefined;
  const hit = matches.find((session) => session.id === pinnedId);
  if (!hit) {
    terminalDefaultWorkerTabByScope.delete(terminalWorkerScopeKey(repositoryPath, terminalName));
    return undefined;
  }
  return hit;
}

/** 运行面板「新建会话」产出的空标签：优先于旧会话复用。 */
function isFreshIdleTerminalWorkerTab(session: ClaudeSession): boolean {
  return (
    session.status === "idle" &&
    session.messages.length === 0 &&
    !session.claudeSessionId?.trim()
  );
}

/** 同仓库同终端名下的全部 worker 标签（不含磁盘空壳）。 */
export function listTerminalWorkerTabsForEmployee(
  sessions: ClaudeSession[],
  repositoryPath: string,
  terminalName: string,
): ClaudeSession[] {
  const repo = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const target = normalizeTerminalDispatchName(terminalName);
  return sessions.filter((session) => {
    if (!repositoryPathsMatch(session.repositoryPath, repo)) return false;
    const bound = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
    if (!bound || normalizeTerminalDispatchName(bound) !== target) return false;
    return !isDiskOnlyTerminalWorkerTab(session);
  });
}

export function findTerminalWorkerTab(
  sessions: ClaudeSession[],
  repositoryPath: string,
  terminalName: string,
): ClaudeSession | undefined {
  const matches = listTerminalWorkerTabsForEmployee(sessions, repositoryPath, terminalName);
  if (matches.length === 0) return undefined;

  const pinned = resolvePinnedTerminalWorkerTab(matches, repositoryPath, terminalName);
  if (pinned) return pinned;

  if (matches.length === 1) return matches[0];

  const freshIdle = matches.filter(isFreshIdleTerminalWorkerTab);
  if (freshIdle.length > 0) {
    return freshIdle.sort((left, right) => right.createdAt - left.createdAt)[0];
  }
  return matches.sort(
    (left, right) => terminalWorkerSessionSortKey(right) - terminalWorkerSessionSortKey(left),
  )[0];
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
    opts?: {
      userBubblePrompt?: string;
      defaultInstructionApplied?: string;
    },
  ) => boolean;
  appendSystemMessage: (sessionId: string, text: string) => void;
  /** 关闭磁盘空壳标签，避免同一终端堆积多个无效 tab。 */
  closeWorkerTab?: (tabId: string) => void;
  /**
   * 派发成功后的可选回调（默认不切换中栏主会话；终端在后台执行，运行态见侧栏运行面板）。
   */
  onDispatched?: (workerTabId: string) => void;
};

function purgeDiskOnlyTerminalWorkerTabs(
  deps: Pick<TerminalDispatchDeps, "getSessions" | "closeWorkerTab">,
  repositoryPath: string,
  terminalName: string,
): void {
  const repo = normalizeRepositoryPathKey(repositoryPath) || repositoryPath.trim();
  const target = normalizeTerminalDispatchName(terminalName);
  for (const session of deps.getSessions()) {
    if (!repositoryPathsMatch(session.repositoryPath, repo)) continue;
    const bound = extractBoundEmployeeNameFromSessionRepositoryName(session.repositoryName);
    if (!bound || normalizeTerminalDispatchName(bound) !== target) continue;
    if (isDiskOnlyTerminalWorkerTab(session)) {
      deps.closeWorkerTab?.(session.id);
    }
  }
}

export async function resolveOrCreateTerminalWorkerTab(
  deps: Pick<TerminalDispatchDeps, "getSessions" | "createSession" | "closeWorkerTab">,
  repositoryPath: string,
  repositoryDisplayName: string,
  terminal: EmployeeItem,
): Promise<{ workerTabId: string; created: boolean }> {
  purgeDiskOnlyTerminalWorkerTabs(deps, repositoryPath, terminal.name);

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

/** 运行面板「新建会话」：清理同终端下的空 idle 占位标签，再创建新的默认 worker（保留已有历史）。 */
export async function createFreshTerminalWorkerTab(
  deps: Pick<TerminalDispatchDeps, "getSessions" | "createSession" | "closeWorkerTab">,
  repositoryPath: string,
  repositoryDisplayName: string,
  terminal: EmployeeItem,
): Promise<{ workerTabId: string }> {
  purgeDiskOnlyTerminalWorkerTabs(deps, repositoryPath, terminal.name);
  const siblings = listTerminalWorkerTabsForEmployee(
    deps.getSessions(),
    repositoryPath,
    terminal.name,
  );
  for (const tab of siblings) {
    if (tab.status === "running" || tab.status === "connecting") continue;
    // 仅回收未使用的空标签；已完成/有 transcript 的历史会话必须保留。
    if (isFreshIdleTerminalWorkerTab(tab)) {
      deps.closeWorkerTab?.(tab.id);
    }
  }
  const base = repositoryDisplayBase(repositoryDisplayName);
  const workerTabId = await deps.createSession(
    repositoryPath,
    `${base}/员工:${terminal.name}`,
    { skipActivate: true, connectionKind: "oneshot" },
  );
  setTerminalDefaultWorkerTab(repositoryPath, terminal.name, workerTabId);
  return { workerTabId };
}

async function waitForTerminalTurnStarted(
  getSessions: () => ClaudeSession[],
  workerTabId: string,
  maxWaitMs = 3200,
): Promise<boolean> {
  const key = workerTabId.trim();
  if (!key) return false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const worker = getSessions().find((item) => item.id === key);
    if (terminalWorkerTurnLooksStarted(worker)) {
      return true;
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), 40);
    });
  }
  const worker = getSessions().find((item) => item.id === key);
  return terminalWorkerTurnLooksStarted(worker);
}

function terminalWorkerTurnLooksStarted(worker: ClaudeSession | undefined): boolean {
  if (!worker) return false;
  const hasUser = worker.messages.some((item) => item.role === "user");
  if (!hasUser) return false;
  return worker.status === "running" || worker.status === "connecting";
}

async function dispatchTerminalWorkerTurn(
  deps: TerminalDispatchDeps,
  mainSession: ClaudeSession,
  terminal: EmployeeItem,
  taskPrompt: string,
  mainSessionId: string,
  sessionDefaultInstruction: string,
): Promise<"failed" | "ok"> {
  const resolveContext = await loadDefaultInstructionResolveContext(mainSession.repositoryPath);
  const effectiveTaskPrompt = resolveTerminalTaskPromptWithDefaults(
    taskPrompt,
    terminal,
    sessionDefaultInstruction,
    resolveContext,
  );
  const defaultInstructionApplied = resolveTerminalDefaultInstructionApplied(
    taskPrompt,
    terminal,
    sessionDefaultInstruction,
    resolveContext,
  );
  const { outboundPrompt, userBubblePrompt } = resolveTerminalDispatchPrompts(
    effectiveTaskPrompt,
    terminal.agentType,
  );
  if (!userBubblePrompt.trim()) {
    const warningText = `终端「${terminal.name}」未收到可执行内容，请补充任务说明后重试。`;
    message.warning(warningText);
    deps.appendSystemMessage(mainSessionId, warningText);
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

  const spawnOk = deps.executeTerminalSession(workerTabId, outboundPrompt.trim(), {
    userBubblePrompt,
    ...(defaultInstructionApplied ? { defaultInstructionApplied } : {}),
  });
  if (!spawnOk) {
    const engineTitle = terminalExecutionEngineTitle(terminal);
    const failureText = `任务分发失败：终端「${terminal.name}」未能启动 ${engineTitle}（请检查并发上限、CLI 安装或网络）。`;
    message.warning(failureText);
    deps.appendSystemMessage(mainSessionId, failureText);
    return "failed";
  }

  const started = await waitForTerminalTurnStarted(deps.getSessions, workerTabId);
  if (!started) {
    const failureText = `任务分发失败：终端「${terminal.name}」未进入执行态（请勿点击仅有 UUID 的空历史会话，请重试派发）。`;
    message.warning(failureText);
    deps.appendSystemMessage(mainSessionId, failureText);
    return "failed";
  }

  deps.appendSystemMessage(
    mainSessionId,
    formatTerminalDispatchRecord(
      terminal.name,
      workerTabId,
      userBubblePrompt,
      terminal.executionEngine,
    ),
  );
  mirrorTerminalToControlDock(deps, workerTabId, mainSessionId);
  deps.onDispatched?.(workerTabId);
  return "ok";
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
 * @终端 → 终端 worker 标签：解析目标、创建/复用 Wise 标签、强制新回合执行（Claude / Codex / Cursor）。
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
  const explicitTerminal = explicitName
    ? findTerminalEmployeeByName(deps.employees, explicitName)
    : undefined;

  if (explicitName && !explicitTerminal) {
    const warningText = `未找到终端「${explicitName}」，请检查终端名称后重试。`;
    message.warning(warningText);
    deps.appendSystemMessage(input.mainSessionId, warningText);
    return "failed";
  }

  const terminals = explicitTerminal
    ? [explicitTerminal]
    : dedupeTerminalEmployees(mentioned);
  if (terminals.length === 0) {
    return explicitName ? "failed" : "not_terminal";
  }

  const taskPrompt =
    mentioned.length > 0
      ? stripTerminalMentionsFromPrompt(input.prompt, deps.employees)
      : input.prompt;

  let sessionDefaultInstruction = "";
  try {
    sessionDefaultInstruction = await loadComposerDefaultInstructionFromStore();
  } catch {
    /* 读取失败时不阻塞派发 */
  }

  let okCount = 0;
  let failCount = 0;
  for (const terminal of terminals) {
    const result = await dispatchTerminalWorkerTurn(
      deps,
      mainSession,
      terminal,
      taskPrompt,
      input.mainSessionId,
      sessionDefaultInstruction,
    );
    if (result === "ok") {
      okCount += 1;
    } else {
      failCount += 1;
    }
  }

  if (okCount > 0) return "ok";
  if (failCount > 0) return "failed";
  return "not_terminal";
}
