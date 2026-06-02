import type { ClaudeSession } from "../types";
import {
  CLAUDE_DISK_JSONL_TAIL_LINES_INITIAL,
  CLAUDE_DISK_JSONL_TAIL_LINES_LAZY,
  CLAUDE_DISK_JSONL_TAIL_LINES_LOAD_MORE,
} from "../constants/claudeMessageListWindow";
import { sessionMessagesFromJsonlLines } from "../utils/sessionMessagesMemory";
import { isTerminalWorkerWiseTab, sanitizeTerminalWorkerTranscriptMessages } from "../services/terminalDispatch";
import type { SessionExecutionEngine } from "../types";

type SetSessions = (updater: (prev: ClaudeSession[]) => ClaudeSession[]) => void;

function resolveDiskTranscriptKey(session: ClaudeSession, engine: SessionExecutionEngine): string {
  return engine === "cursor" ? session.id.trim() : session.claudeSessionId?.trim() ?? "";
}

export async function reloadFullDiskTranscriptByKey(params: {
  sessionKey: string;
  sessions: ClaudeSession[];
  setSessions: SetSessions;
  diskTailLinesBySession: Map<string, number>;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  loadSessionTranscriptLines: (
    session: ClaudeSession,
    sessionId: string,
    tailLines: number | null,
  ) => Promise<string[]>;
}): Promise<void> {
  const raw = params.sessionKey.trim();
  if (!raw) return;
  const session = params.sessions.find((x) => x.id === raw || x.claudeSessionId === raw);
  if (!session) return;
  const tabId = session.id;
  const repositoryPath = session.repositoryPath?.trim();
  const engine = params.resolveSessionExecutionEngine(session);
  const diskKey = resolveDiskTranscriptKey(session, engine);
  if (!repositoryPath || !diskKey) return;
  const lines = await params.loadSessionTranscriptLines(session, diskKey, null);
  params.diskTailLinesBySession.set(tabId, lines.length);
  const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
    tailRequestLines: Math.max(lines.length, 1),
    fullTranscript: true,
    unlimitedMessageCount: true,
  });
  if (messages.length === 0) return;
  const nextMessages = isTerminalWorkerWiseTab(session)
    ? sanitizeTerminalWorkerTranscriptMessages(messages)
    : messages;
  params.setSessions((prev) =>
    prev.map((row) =>
      row.id === tabId
        ? {
            ...row,
            messages: nextMessages,
            diskTranscriptPartial,
            transcriptMemoryUnlimited: true,
          }
        : row,
    ),
  );
}

export async function applyDiskTranscriptTail(params: {
  session: ClaudeSession;
  tailLines: number;
  setSessions: SetSessions;
  diskTailLinesBySession: Map<string, number>;
  resolveSessionExecutionEngine: (session: ClaudeSession) => SessionExecutionEngine;
  loadSessionTranscriptLines: (
    session: ClaudeSession,
    sessionId: string,
    tailLines: number | null,
  ) => Promise<string[]>;
}): Promise<void> {
  const repositoryPath = params.session.repositoryPath?.trim();
  const engine = params.resolveSessionExecutionEngine(params.session);
  const diskKey = resolveDiskTranscriptKey(params.session, engine);
  if (!repositoryPath || !diskKey) return;
  const lines = await params.loadSessionTranscriptLines(params.session, diskKey, params.tailLines);
  const { messages, diskTranscriptPartial } = sessionMessagesFromJsonlLines(lines, {
    tailRequestLines: params.tailLines,
  });
  if (messages.length === 0) return;
  const nextMessages = isTerminalWorkerWiseTab(params.session)
    ? sanitizeTerminalWorkerTranscriptMessages(messages)
    : messages;
  params.diskTailLinesBySession.set(params.session.id, params.tailLines);
  params.setSessions((prev) =>
    prev.map((row) =>
      row.id === params.session.id
        ? {
            ...row,
            messages: nextMessages,
            diskTranscriptPartial,
            transcriptMemoryUnlimited: false,
          }
        : row,
    ),
  );
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
  const session = params.sessions.find((x) => x.id === raw || x.claudeSessionId === raw);
  if (!session) return;
  const engine = params.resolveSessionExecutionEngine(session);
  const hasDisk = engine === "cursor" ? Boolean(session.id.trim()) : Boolean(session.claudeSessionId?.trim());
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
