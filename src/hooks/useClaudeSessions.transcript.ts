import type { ClaudeSession } from "../types";
import {
  CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
  CLAUDE_DISK_JSONL_TAIL_LINES_LAZY,
  CLAUDE_DISK_JSONL_TAIL_LINES_LOAD_MORE,
} from "../constants/claudeMessageListWindow";
import { sessionMessagesFromJsonlLines } from "../utils/sessionMessagesMemory";
import { isTerminalWorkerWiseTab, sanitizeTerminalWorkerTranscriptMessages } from "../services/terminalDispatch";
import type { ClaudeMessage } from "../types";
import { CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT } from "../utils/claudeTurnCompleteGate";
import type { SessionExecutionEngine } from "../types";
import {
  resolveDiskTranscriptSessionKey,
  resolveDiskTranscriptSource,
  resolveDiskTranscriptSourceCandidates,
  sessionHasDiskTranscript,
  usesWiseTabIdForDiskTranscript,
  type DiskTranscriptSource,
} from "../utils/sessionExecutionEngine";
import { assistantMessageVisiblePlainText } from "../services/claudeSessionState";
import { userMessagePlainTextForDisplay, systemMessagePlainText } from "../utils/claudeChatMessageDisplay";
import { findSessionByTabOrClaudeId } from "../utils/claudeSessionSelection";
import { deriveSessionListPreviewFromMessages } from "../utils/sessionListPreview";

type SetSessions = (updater: (prev: ClaudeSession[]) => ClaudeSession[]) => void;

/** transcript 落盘目录 + 该目录下的文件名 key。 */
export interface DiskTranscriptCandidate {
  source: DiskTranscriptSource;
  key: string;
}

type LoadSessionTranscriptLines = (
  session: ClaudeSession,
  sessionId: string,
  tailLines: number | null,
  source?: DiskTranscriptSource,
) => Promise<string[]>;

/** 主会话 claudeSessionId 与 Wise tab id 不一致时，依次尝试多个磁盘 key。 */
export function resolveDiskTranscriptKeyCandidates(
  session: { id: string; claudeSessionId?: string | null },
  engine: SessionExecutionEngine,
): string[] {
  const out: string[] = [];
  const push = (key: string | undefined | null) => {
    const trimmed = key?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };
  push(resolveDiskTranscriptSessionKey(session, engine));
  push(session.claudeSessionId);
  const tabId = session.id?.trim();
  const claudeId = session.claudeSessionId?.trim();
  // Claude：仅当尚无 claudeSessionId、或 tab id 本身就是磁盘 session id 时才用 id 兜底，
  // 避免把 Wise 本地 tab UUID 当成别的 jsonl 文件名误加载。
  if (
    tabId &&
    (usesWiseTabIdForDiskTranscript(engine) || !claudeId || tabId === claudeId)
  ) {
    push(tabId);
  }
  return out;
}

/** Map a disk transcript source back to a representative engine for key resolution. */
function diskSourceToKeyEngine(source: DiskTranscriptSource): SessionExecutionEngine {
  if (source === "cursor") return "cursor";
  if (source === "codex_rpc") return "codex-rpc";
  return "claude";
}

/**
 * 会话的落盘目录不由当前执行引擎唯一决定：Claude 磁盘扫描出的历史会话会出现在
 * executionEngine 已改成 cursor 的仓库下，反之亦然。先按当前引擎对应目录找，
 * 找不到再到另一个目录兜底，避免历史消息读不出来只显示空状态。
 */
export function resolveDiskTranscriptCandidates(
  session: { id: string; claudeSessionId?: string | null },
  engine: SessionExecutionEngine,
): DiskTranscriptCandidate[] {
  const primarySource = resolveDiskTranscriptSource(engine);
  const out: DiskTranscriptCandidate[] = [];
  const seen = new Set<string>();
  for (const source of resolveDiskTranscriptSourceCandidates(engine)) {
    // 兜底目录用该目录自身的 key 规则，避免拿 Wise tab id 去撞 Claude 目录里的无关 jsonl。
    const keyEngine = source === primarySource ? engine : diskSourceToKeyEngine(source);
    for (const key of resolveDiskTranscriptKeyCandidates(session, keyEngine)) {
      const dedupeKey = `${source}:${key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ source, key });
    }
  }
  return out;
}

async function loadSessionTranscriptLinesWithKeyFallback(
  session: ClaudeSession,
  engine: SessionExecutionEngine,
  tailLines: number | null,
  loadSessionTranscriptLines: LoadSessionTranscriptLines,
): Promise<{ lines: string[]; diskKey: string }> {
  const candidates = resolveDiskTranscriptCandidates(session, engine);
  if (candidates.length === 0) return { lines: [], diskKey: "" };
  let lastLines: string[] = [];
  let lastKey = candidates[0]!.key;
  for (const candidate of candidates) {
    lastKey = candidate.key;
    let lines: string[] = [];
    try {
      lines = await loadSessionTranscriptLines(
        session,
        candidate.key,
        tailLines,
        candidate.source,
      );
    } catch {
      // 单个来源不可读（路径校验失败等）不应中断其余候选。
      continue;
    }
    lastLines = lines;
    if (lines.length > 0) {
      return { lines, diskKey: candidate.key };
    }
  }
  return { lines: lastLines, diskKey: lastKey };
}

function cloneDiskAssistantMessage(message: ClaudeMessage): ClaudeMessage {
  return {
    ...message,
    id: Date.now(),
    timestamp: Date.now(),
    parts: message.parts?.map((part) => ({ ...part })),
  };
}

function currentTurnAssistantMessage(messages: readonly ClaudeMessage[]): ClaudeMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role === "system") continue;
    if (msg.role === "assistant") return msg;
    if (msg.role === "user") return null;
  }
  return null;
}

/** 当前回合助手是否已有可见输出（正文 / 思考 / 工具块），不仅限于 text part。 */
export function latestTurnHasVisibleAssistantContent(messages: readonly ClaudeMessage[]): boolean {
  const msg = currentTurnAssistantMessage(messages);
  if (!msg) return false;
  if (assistantMessageVisiblePlainText(msg).trim().length > 0) return true;
  const parts = msg.parts ?? [];
  return parts.some((part) => part.type === "reasoning" || part.type === "tool_use");
}

export function latestTurnHasCompletedToolUse(messages: readonly ClaudeMessage[]): boolean {
  const msg = currentTurnAssistantMessage(messages);
  if (!msg) return false;
  return (msg.parts ?? []).some(
    (part) =>
      part.type === "tool_use" &&
      (part.status === "completed" ||
        part.status === "error" ||
        Boolean(part.output?.trim()) ||
        Boolean(part.error?.trim())),
  );
}

/** 当前回合是否存在尚未落盘的 tool_use（仍在执行或等待 result）。 */
export function latestTurnHasInFlightToolUse(messages: readonly ClaudeMessage[]): boolean {
  const msg = currentTurnAssistantMessage(messages);
  if (!msg) return false;
  return (msg.parts ?? []).some((part) => {
    if (part.type !== "tool_use") return false;
    if (part.status === "completed" || part.status === "error") return false;
    if (part.output?.trim() || part.error?.trim()) return false;
    return true;
  });
}

/** oneshot 推迟 complete 后，若长时间无新 stdout，仍须强制收尾以释放 running 状态。 */
export const ONESHOT_DEFERRED_COMPLETE_FORCE_MS = 20_000;
/** oneshot 推迟 complete 后，按 stdout 静默时长递增重试收尾。 */
export const ONESHOT_DEFERRED_COMPLETE_RETRY_DELAYS_MS = [80, 400, 1200, 4000, 12_000] as const;

export function shouldForceFinalizeDeferredOneshotComplete(
  messages: readonly ClaudeMessage[],
  deferredForMs: number,
): boolean {
  if (deferredForMs < ONESHOT_DEFERRED_COMPLETE_FORCE_MS) return false;
  return latestTurnHasVisibleAssistantContent(messages);
}

/**
 * Oneshot 在 `type:result` 时就会发 complete，但 stdout 可能仍有助手增量。
 * 尚无正文、仅有思考块时先不收尾，避免 UI 冻在「思考过程」且拆掉 invocation 监听。
 */
export function shouldDeferOneshotTurnComplete(
  messages: readonly ClaudeMessage[],
  payloadSuccess: boolean,
): boolean {
  if (!latestTurnHasVisibleAssistantContent(messages)) {
    return false;
  }
  const msg = currentTurnAssistantMessage(messages);
  if (!msg || assistantMessageVisiblePlainText(msg).trim().length > 0) {
    return false;
  }
  if (latestTurnHasInFlightToolUse(messages)) {
    return true;
  }
  if (!payloadSuccess) {
    return true;
  }
  return !latestTurnHasCompletedToolUse(messages);
}

/** 终端 worker 当前回合（自最后一条 user 起）是否已有可见助手回复。 */
export function latestTerminalTurnHasAssistant(messages: readonly ClaudeMessage[]): boolean {
  return latestTurnHasVisibleAssistantContent(messages);
}

function lastNonSystemMessage(messages: readonly ClaudeMessage[]): ClaudeMessage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]!;
    if (msg.role !== "system") return msg;
  }
  return null;
}

/** running 会话内存 transcript 领先磁盘时（刚发送的用户气泡尚未落盘），禁止 disk reload 覆盖。 */
export function shouldPreserveMemoryTranscriptOverDisk(
  session: ClaudeSession,
  diskMessages: readonly ClaudeMessage[],
): boolean {
  if (isTerminalWorkerWiseTab(session)) return false;
  if (session.status !== "running" && session.status !== "connecting") return false;
  if (session.messages.length === 0) return false;
  if (session.messages.length > diskMessages.length) return true;
  const memoryLast = lastNonSystemMessage(session.messages);
  const diskLast = lastNonSystemMessage(diskMessages);
  if (memoryLast?.role === "user" && diskLast?.role !== "user") return true;
  if (
    memoryLast?.role === "user" &&
    diskLast?.role === "user" &&
    userMessagePlainTextForDisplay(memoryLast).trim() !==
      userMessagePlainTextForDisplay(diskLast).trim()
  ) {
    return true;
  }
  return false;
}

/**
 * 全量磁盘重载前的运行态保护：running/connecting 会话若内存 transcript 领先磁盘
 * （刚发送的用户气泡尚未落盘），或当前轮已有可见助手内容而磁盘尚未落盘，则跳过全量覆盖，
 * 避免抹掉正在进行的回合；用户回合结束后可再次滚动触发。terminal worker 走专用合并逻辑，不跳过。
 */
export function shouldSkipFullDiskReloadForRunningSession(
  session: ClaudeSession,
  diskMessages: readonly ClaudeMessage[],
): boolean {
  if (isTerminalWorkerWiseTab(session)) return false;
  if (session.status !== "running" && session.status !== "connecting") return false;
  if (shouldPreserveMemoryTranscriptOverDisk(session, diskMessages)) return true;
  if (
    latestTurnHasVisibleAssistantContent(session.messages) &&
    !latestTurnHasVisibleAssistantContent(diskMessages)
  ) {
    return true;
  }
  return false;
}

function lastDiskAssistantMessage(disk: readonly ClaudeMessage[]): ClaudeMessage | null {
  for (let i = disk.length - 1; i >= 0; i -= 1) {
    const msg = disk[i]!;
    if (msg.role !== "assistant") continue;
    if (assistantMessageVisiblePlainText(msg).trim().length === 0) continue;
    return msg;
  }
  return null;
}

/**
 * 终端 worker 保留 Wise 标签内多轮内存历史；单轮 Claude jsonl 只用于补齐当前回合缺失的助手气泡。
 * 返回 null 表示不应改写内存 messages。
 */
export function resolveTerminalWorkerMessagesAfterDiskLoad(
  session: ClaudeSession,
  diskMessages: ClaudeMessage[],
): ClaudeMessage[] | null {
  const disk = sanitizeTerminalWorkerTranscriptMessages(diskMessages);
  if (disk.length === 0) return null;

  const diskAssistant = lastDiskAssistantMessage(disk);
  const memory = session.messages;
  if (memory.length === 0) {
    return diskAssistant ? disk : null;
  }
  if (!diskAssistant) return null;

  // 内存当前回合已有助手输出时，磁盘 jsonl 只含单轮切片，禁止整段覆盖。
  if (latestTerminalTurnHasAssistant(memory)) {
    return null;
  }

  const lastMemory = memory[memory.length - 1];
  if (lastMemory?.role === "user") {
    return [...memory, cloneDiskAssistantMessage(diskAssistant)];
  }

  const lastUserIdx = (() => {
    for (let i = memory.length - 1; i >= 0; i -= 1) {
      if (memory[i]?.role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx >= 0) {
    const memoryUserText = userMessagePlainTextForDisplay(memory[lastUserIdx]!).trim();
    const diskUser = disk.find((msg) => msg.role === "user");
    const diskUserText = diskUser ? userMessagePlainTextForDisplay(diskUser).trim() : "";
    if (memoryUserText && diskUserText && memoryUserText === diskUserText) {
      return [...memory, cloneDiskAssistantMessage(diskAssistant)];
    }
  }

  return null;
}

export function terminalDiskTranscriptRecoveredStatus(
  previousStatus: ClaudeSession["status"],
  hasAssistant: boolean,
  isTerminalWorker: boolean,
): ClaudeSession["status"] {
  if (!isTerminalWorker || !hasAssistant) return previousStatus;
  if (
    previousStatus === "cancelled" ||
    previousStatus === "error" ||
    previousStatus === "running" ||
    previousStatus === "connecting"
  ) {
    return "completed";
  }
  return previousStatus;
}

export async function reloadFullDiskTranscriptByKey(params: {
  sessionKey: string;
  sessions: ClaudeSession[];
  setSessions: SetSessions;
  diskTailLinesBySession: Map<string, number>;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  loadSessionTranscriptLines: LoadSessionTranscriptLines;
}): Promise<boolean> {
  const raw = params.sessionKey.trim();
  if (!raw) return false;
  const session = findSessionByTabOrClaudeId(params.sessions, raw);
  if (!session) return false;
  const tabId = session.id;
  const repositoryPath = session.repositoryPath?.trim();
  const engine = params.resolveSessionExecutionEngine(session);
  if (!repositoryPath) return false;
  const { lines, diskKey } = await loadSessionTranscriptLinesWithKeyFallback(
    session,
    engine,
    null,
    params.loadSessionTranscriptLines,
  );
  if (!diskKey) return false;
  params.diskTailLinesBySession.set(tabId, lines.length);
  const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
    tailRequestLines: Math.max(lines.length, 1),
    fullTranscript: true,
    unlimitedMessageCount: true,
  });
  if (messages.length === 0) return false;
  const isTerminalWorker = isTerminalWorkerWiseTab(session);
  const sanitizedDisk = isTerminalWorker
    ? sanitizeTerminalWorkerTranscriptMessages(messages)
    : messages;
  const mergedTerminalMessages = isTerminalWorker
    ? resolveTerminalWorkerMessagesAfterDiskLoad(session, sanitizedDisk)
    : null;
  const nextMessages = isTerminalWorker ? mergedTerminalMessages : sanitizedDisk;
  if (!nextMessages || nextMessages.length === 0) return false;
  // 运行态保护：内存领先磁盘或当前轮未落盘时跳过全量覆盖，避免抹掉进行中的回合。
  if (shouldSkipFullDiskReloadForRunningSession(session, sanitizedDisk)) {
    return false;
  }
  const hasAssistant = nextMessages.some((message) => message.role === "assistant");
  params.setSessions((prev) =>
    prev.map((row) => {
      if (row.id !== tabId) return row;
      const recoveredMessages =
        isTerminalWorker && hasAssistant
          ? nextMessages.filter(
              (message) =>
                !(
                  message.role === "system" &&
                  systemMessagePlainText(message).includes(CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT)
                ),
            )
          : nextMessages;
      const previewFromMessages = deriveSessionListPreviewFromMessages(recoveredMessages);
      return {
        ...row,
        messages: recoveredMessages,
        // 全量落盘后对齐侧栏标题，避免旧 diskPreview 与当前 messages 长期不一致。
        diskPreview: previewFromMessages || row.diskPreview,
        diskTranscriptPartial,
        transcriptMemoryUnlimited: true,
        status: terminalDiskTranscriptRecoveredStatus(row.status, hasAssistant, isTerminalWorker),
      };
    }),
  );
  return true;
}

export async function applyDiskTranscriptTail(params: {
  session: ClaudeSession;
  tailLines: number;
  setSessions: SetSessions;
  diskTailLinesBySession: Map<string, number>;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  loadSessionTranscriptLines: LoadSessionTranscriptLines;
}): Promise<boolean> {
  const repositoryPath = params.session.repositoryPath?.trim();
  const engine = params.resolveSessionExecutionEngine(params.session);
  if (!repositoryPath) return false;
  const { lines, diskKey } = await loadSessionTranscriptLinesWithKeyFallback(
    params.session,
    engine,
    params.tailLines,
    params.loadSessionTranscriptLines,
  );
  if (!diskKey) return false;
  const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
    tailRequestLines: params.tailLines,
  });
  if (messages.length === 0) return false;
  const isTerminalWorker = isTerminalWorkerWiseTab(params.session);
  const sanitizedDisk = isTerminalWorker
    ? sanitizeTerminalWorkerTranscriptMessages(messages)
    : messages;
  const nextMessages = isTerminalWorker
    ? resolveTerminalWorkerMessagesAfterDiskLoad(params.session, sanitizedDisk)
    : sanitizedDisk;
  if (!nextMessages || nextMessages.length === 0) return false;
  params.diskTailLinesBySession.set(params.session.id, params.tailLines);
  // 尾部窗口的首条用户消息不是会话开头，拿它改写 diskPreview 会把长 prompt 的中段
  // （例如代码审查 harness 里的 diff 片段）当成侧栏标题。只有读到完整 transcript 才对齐标题。
  const previewFromMessages = diskTranscriptPartial
    ? ""
    : deriveSessionListPreviewFromMessages(nextMessages);
  params.setSessions((prev) =>
    prev.map((row) =>
      row.id === params.session.id
        ? {
            ...row,
            messages: nextMessages,
            diskPreview: previewFromMessages || row.diskPreview,
            diskTranscriptPartial,
            transcriptMemoryUnlimited: false,
          }
        : row,
    ),
  );
  return true;
}

export async function loadMoreTranscriptByKey(params: {
  sessionKey: string;
  sessions: ClaudeSession[];
  diskTailLinesBySession: Map<string, number>;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  reloadFullDiskTranscript: (sessionKey: string) => Promise<void>;
  applyDiskTranscriptTail: (session: ClaudeSession, tailLines: number) => Promise<void>;
}): Promise<void> {
  const raw = params.sessionKey.trim();
  if (!raw) return;
  const session = findSessionByTabOrClaudeId(params.sessions, raw);
  if (!session) return;
  const engine = params.resolveSessionExecutionEngine(session);
  const hasDisk = sessionHasDiskTranscript(session, engine);
  if (!hasDisk) return;
  const prevTail =
    params.diskTailLinesBySession.get(session.id) ?? CLAUDE_DISK_JSONL_TAIL_LINES_LAZY;
  if (prevTail >= CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL) {
    await params.reloadFullDiskTranscript(session.id);
    return;
  }
  const nextTail = Math.min(
    prevTail + CLAUDE_DISK_JSONL_TAIL_LINES_LOAD_MORE,
    CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
  );
  await params.applyDiskTranscriptTail(session, nextTail);
}
