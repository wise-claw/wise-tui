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
import type { NativeCliEngine as NativeCliDiskSessionEngine } from "../types";
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
  if (source === "native_codex") return "codex-rpc";
  if (source === "native_deepseek") return "deepseek";
  if (source === "native_cursor") return "cursor";
  return "claude";
}

/** 会话被标记为外部 CLI 原生会话时，对应的原生转录来源。 */
export function resolveNativeCliTranscriptSource(
  session: { nativeCliSource?: NativeCliDiskSessionEngine | null; claudeSessionId?: string | null; id?: string },
): DiskTranscriptCandidate | null {
  const engine = session.nativeCliSource;
  if (engine !== "codex" && engine !== "deepseek" && engine !== "cursor") return null;
  const key = session.claudeSessionId?.trim() || session.id?.trim() || "";
  if (!key) return null;
  const source =
    engine === "codex"
      ? "native_codex"
      : engine === "deepseek"
        ? "native_deepseek"
        : "native_cursor";
  return { source, key };
}

/**
 * 会话的落盘目录不由当前执行引擎唯一决定：Claude 磁盘扫描出的历史会话会出现在
 * executionEngine 已改成 cursor 的仓库下，反之亦然。先按当前引擎对应目录找，
 * 找不到再到另一个目录兜底，避免历史消息读不出来只显示空状态。
 */
export function resolveDiskTranscriptCandidates(
  session: {
    id: string;
    claudeSessionId?: string | null;
    /** 外部 CLI 原生会话：其转录优先于 Wise 侧 `*-runs`。 */
    nativeCliSource?: NativeCliDiskSessionEngine | null;
  },
  engine: SessionExecutionEngine,
): DiskTranscriptCandidate[] {
  const primarySource = resolveDiskTranscriptSource(engine);
  const out: DiskTranscriptCandidate[] = [];
  const seen = new Set<string>();
  // 原生会话优先读 CLI 自己的转录：它包含加入 Wise 之前的完整历史，
  // 且 Wise 侧 `*-runs` 只会记录 Wise 跑过的那些回合。
  const nativeCandidate = resolveNativeCliTranscriptSource(session);
  if (nativeCandidate) {
    seen.add(`${nativeCandidate.source}:${nativeCandidate.key}`);
    out.push(nativeCandidate);
  }
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
    // 仅换 id 避免与内存气泡冲突；保留磁盘 timestamp，防止侧栏被顶成「刚刚」。
    id: Date.now(),
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
export const ONESHOT_DEFERRED_COMPLETE_RETRY_DELAYS_MS = [
  80, 400, 1200, 4000, 12_000, ONESHOT_DEFERRED_COMPLETE_FORCE_MS + 1,
] as const;

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

export function transcriptHasDisplayUser(messages: readonly ClaudeMessage[]): boolean {
  return messages.some((msg) => {
    if (msg.role !== "user") return false;
    return Boolean(userMessagePlainTextForDisplay(msg).trim());
  });
}

/** 尾窗切片像从回合中段切入：首条非 system 是助手（常见于旧 Codex RPC token 落盘）。 */
export function diskTranscriptLooksMidTurnTruncated(
  messages: readonly ClaudeMessage[],
): boolean {
  for (const msg of messages) {
    if (msg.role === "system") continue;
    return msg.role === "assistant";
  }
  return false;
}

/**
 * 尾部窗口应升级为全量重载：丢掉用户回显，或从助手中段切入。
 * 已读完整文件（非 partial）时不再升级，避免空转。
 */
export function shouldUpgradeDiskTailToFullTranscript(input: {
  messages: readonly ClaudeMessage[];
  diskTranscriptPartial: boolean;
  linesLength: number;
  tailLines: number;
}): boolean {
  if (!input.diskTranscriptPartial && input.linesLength < input.tailLines) {
    return false;
  }
  if (!transcriptHasDisplayUser(input.messages)) return true;
  return (
    input.diskTranscriptPartial && diskTranscriptLooksMidTurnTruncated(input.messages)
  );
}

/** running 会话内存 transcript 领先磁盘时（刚发送的用户气泡尚未落盘），禁止 disk reload 覆盖。 */
export function shouldPreserveMemoryTranscriptOverDisk(
  session: ClaudeSession,
  diskMessages: readonly ClaudeMessage[],
): boolean {
  if (isTerminalWorkerWiseTab(session)) return false;
  // Codex RPC 曾把每个 token delta 写入 JSONL；尾部窗口重载会丢掉开头的用户回显，
  // 只剩助手正文中段。只要内存里还有用户气泡而磁盘切片没有，就禁止覆盖（含 idle）。
  if (
    session.messages.length > 0 &&
    transcriptHasDisplayUser(session.messages) &&
    !transcriptHasDisplayUser(diskMessages)
  ) {
    return true;
  }
  // 磁盘切片从助手中段开始，而内存已有完整用户回显：禁止用残片覆盖。
  if (
    session.messages.length > 0 &&
    transcriptHasDisplayUser(session.messages) &&
    diskTranscriptLooksMidTurnTruncated(diskMessages)
  ) {
    return true;
  }
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

/**
 * 内存 transcript 是否仍是流式残片、需要被磁盘覆盖。
 *
 * Wise tab 落盘引擎（Codex RPC / Cursor 等）在回合结束后常把截断助手留在
 * tabs.json；`sessionShouldRetainMessagesWhenInactive` 又因 `executionEngine` 禁止清空，
 * 且 `diskTranscriptPartial` **不落盘**，冷启动后 `messages.length > 0` 会永久跳过 hydrate，
 * 消息列表只剩 2～3 条残片（磁盘上其实有完整 jsonl）。
 *
 * 因此：只要有可恢复的磁盘证据且气泡极少（≤4），一律视为残片强制覆盖。
 * 已有较长侧栏窗口（>4）的 partial 交给滚动「加载更多」，不在此重拉。
 */
export function memoryTranscriptNeedsDiskRefresh(
  session: ClaudeSession,
  engine: SessionExecutionEngine,
): boolean {
  if (session.transcriptMemoryUnlimited === true) return false;
  if (!usesWiseTabIdForDiskTranscript(engine)) return false;
  if (session.status === "running" || session.status === "connecting") return false;
  const hasRunningSystem = session.messages.some((message) => {
    if (message.role !== "system") return false;
    return systemMessagePlainText(message).includes("执行中");
  });
  if (hasRunningSystem) return true;
  if (session.messages.length === 0 || session.messages.length > 4) return false;
  // tabs.json 不持久化 diskTranscriptPartial；冷启动残片常无此标记，但不能因此跳过补全。
  // 不靠 sessionHasDiskTranscript（Wise tab 仅凭 id 即为 true），避免无落盘的草稿反复空转。
  return (
    session.diskTranscriptPartial === true ||
    Boolean(session.claudeSessionId?.trim()) ||
    Boolean(session.diskPreview?.trim())
  );
}

/**
 * 是否应为该会话发起磁盘 transcript 补全。
 *
 * 尚无可恢复的磁盘证据时不发起。运行中/连接中的会话**也允许发起**：
 * @派发 / 新建会话并行执行时，非活动标签的内存正文可能已被淘汰清空（diskTranscriptPartial），
 * 切回时若因 running 跳过补全，整轮消息都不可见；运行态保护由
 * `shouldPreserveMemoryTranscriptOverDisk` / `shouldSkipFullDiskReloadForRunningSession`
 * 在写入时按最新 row 复判，不会覆盖进行中的回合。
 *
 * 内存已有消息时默认跳过；Wise 流式残片（「执行中」system / 极少气泡 + partial）必须覆盖，
 * 否则执行完成的会话永远看不到完整消息列表。
 */
export function shouldRequestDiskTranscriptHydration(
  session: ClaudeSession,
  engine: SessionExecutionEngine,
): boolean {
  const hasDiskEvidence =
    sessionHasDiskTranscript(session, engine) ||
    Boolean(session.claudeSessionId?.trim()) ||
    Boolean(session.diskTranscriptPartial);
  if (!hasDiskEvidence) return false;

  if (session.messages.length === 0) return true;
  return memoryTranscriptNeedsDiskRefresh(session, engine);
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
  // 非 terminal：启动快照上先做一次运行态保护；terminal 必须在 setSessions 里对最新 row 再合并。
  if (!isTerminalWorker) {
    if (sanitizedDisk.length === 0) return false;
    if (shouldSkipFullDiskReloadForRunningSession(session, sanitizedDisk)) {
      return false;
    }
  }
  let applied = false;
  params.setSessions((prev) =>
    prev.map((row) => {
      if (row.id !== tabId) return row;
      // 读取磁盘期间会话可能已开始新一轮（刚发送的用户气泡 / 流式增量领先磁盘）：
      // 对最新 row 复判运行态保护，避免用略旧的磁盘快照覆盖进行中的回合。
      if (shouldSkipFullDiskReloadForRunningSession(row, sanitizedDisk)) {
        return row;
      }
      let recoveredMessages: ClaudeMessage[];
      if (isTerminalWorker) {
        // 必须用最新 row 合并：await 期间流式增量可能已写入内存；用启动快照 merge 会抹掉助手气泡。
        const merged = resolveTerminalWorkerMessagesAfterDiskLoad(row, sanitizedDisk);
        if (!merged || merged.length === 0) return row;
        const hasAssistant = merged.some((message) => message.role === "assistant");
        recoveredMessages = hasAssistant
          ? merged.filter(
              (message) =>
                !(
                  message.role === "system" &&
                  systemMessagePlainText(message).includes(CLAUDE_NO_VISIBLE_REPLY_FAILURE_HINT)
                ),
            )
          : merged;
        applied = true;
        const previewFromMessages = deriveSessionListPreviewFromMessages(recoveredMessages);
        return {
          ...row,
          messages: recoveredMessages,
          diskPreview: previewFromMessages || row.diskPreview,
          diskTranscriptPartial,
          transcriptMemoryUnlimited: true,
          status: terminalDiskTranscriptRecoveredStatus(row.status, hasAssistant, true),
        };
      }
      recoveredMessages = sanitizedDisk;
      applied = true;
      const previewFromMessages = deriveSessionListPreviewFromMessages(recoveredMessages);
      return {
        ...row,
        messages: recoveredMessages,
        // 全量落盘后对齐侧栏标题，避免旧 diskPreview 与当前 messages 长期不一致。
        diskPreview: previewFromMessages || row.diskPreview,
        diskTranscriptPartial,
        transcriptMemoryUnlimited: true,
        status: row.status,
      };
    }),
  );
  if (applied) {
    params.diskTailLinesBySession.set(tabId, lines.length);
  }
  // 返回 true 表示已处理（含最新 row 运行态保护主动跳过）；仅硬失败（无磁盘/空消息）返回 false。
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
  // 尾部窗口丢掉用户回显 / 从助手中段切入（旧版 Codex RPC 逐 token 落盘）→ 升级全量。
  if (
    shouldUpgradeDiskTailToFullTranscript({
      messages,
      diskTranscriptPartial,
      linesLength: lines.length,
      tailLines: params.tailLines,
    })
  ) {
    return reloadFullDiskTranscriptByKey({
      sessionKey: params.session.id,
      sessions: [params.session],
      setSessions: params.setSessions,
      diskTailLinesBySession: params.diskTailLinesBySession,
      resolveSessionExecutionEngine: params.resolveSessionExecutionEngine,
      loadSessionTranscriptLines: params.loadSessionTranscriptLines,
    });
  }
  const isTerminalWorker = isTerminalWorkerWiseTab(params.session);
  const sanitizedDisk = isTerminalWorker
    ? sanitizeTerminalWorkerTranscriptMessages(messages)
    : messages;
  if (!isTerminalWorker) {
    if (sanitizedDisk.length === 0) return false;
    // 内存已有完整用户回显、尾窗却丢掉用户或从助手中段切入：不能用残片覆盖，改拉全量。
    if (shouldPreserveMemoryTranscriptOverDisk(params.session, sanitizedDisk)) {
      return reloadFullDiskTranscriptByKey({
        sessionKey: params.session.id,
        sessions: [params.session],
        setSessions: params.setSessions,
        diskTailLinesBySession: params.diskTailLinesBySession,
        resolveSessionExecutionEngine: params.resolveSessionExecutionEngine,
        loadSessionTranscriptLines: params.loadSessionTranscriptLines,
      });
    }
  }
  let applied = false;
  params.setSessions((prev) =>
    prev.map((row) => {
      if (row.id !== params.session.id) return row;
      // setSessions 时再读最新 row，避免 hydrate 竞态用陈旧 session 覆盖刚发出的用户气泡。
      // 读取磁盘期间会话可能已开始新一轮 / 流式增量领先磁盘：按最新 row 复判运行态保护。
      if (!isTerminalWorker) {
        if (
          shouldSkipFullDiskReloadForRunningSession(row, sanitizedDisk) ||
          shouldPreserveMemoryTranscriptOverDisk(row, sanitizedDisk)
        ) {
          return row;
        }
        // 尾部窗口的首条用户消息不是会话开头，拿它改写 diskPreview 会把长 prompt 的中段
        // （例如代码审查 harness 里的 diff 片段）当成侧栏标题。只有读到完整 transcript 才对齐标题。
        const previewFromMessages = diskTranscriptPartial
          ? ""
          : deriveSessionListPreviewFromMessages(sanitizedDisk);
        applied = true;
        return {
          ...row,
          messages: sanitizedDisk,
          diskPreview: previewFromMessages || row.diskPreview,
          diskTranscriptPartial,
          transcriptMemoryUnlimited: false,
        };
      }
      // terminal：await 期间内存可能已有流式助手；对最新 row 再合并，禁止用启动快照抹掉增量。
      const merged = resolveTerminalWorkerMessagesAfterDiskLoad(row, sanitizedDisk);
      if (!merged || merged.length === 0) return row;
      const previewFromMessages = diskTranscriptPartial
        ? ""
        : deriveSessionListPreviewFromMessages(merged);
      applied = true;
      return {
        ...row,
        messages: merged,
        diskPreview: previewFromMessages || row.diskPreview,
        diskTranscriptPartial,
        transcriptMemoryUnlimited: false,
      };
    }),
  );
  if (applied) {
    params.diskTailLinesBySession.set(params.session.id, params.tailLines);
  }
  // 与全量重载一致：已进入 setSessions（含保护跳过）即视为处理成功。
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
