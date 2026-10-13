import type { ClaudeSession } from "../types";
import { loadClaudeSessionJsonl, loadCodexRpcSessionJsonl } from "./claudeDisk";
import { loadCursorSessionJsonl } from "./cursorDisk";
import { normalizeSessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { resolveDiskTranscriptSessionKey, resolveDiskTranscriptSource } from "../utils/sessionExecutionEngine";

export function sessionAnalysisTranscriptTarget(session: ClaudeSession | null) {
  if (!session?.repositoryPath.trim()) return null;
  const engine = normalizeSessionExecutionEngine(session.executionEngine);
  const key = resolveDiskTranscriptSessionKey(session, engine);
  if (!key) return null;
  return { source: resolveDiskTranscriptSource(engine), key, repositoryPath: session.repositoryPath.trim() };
}

export async function loadSessionAnalysisTranscript(target: NonNullable<ReturnType<typeof sessionAnalysisTranscriptTarget>>, tailLines: number) {
  const loader = target.source === 'codex_rpc' ? loadCodexRpcSessionJsonl : target.source === 'cursor' ? loadCursorSessionJsonl : loadClaudeSessionJsonl;
  return loader(target.repositoryPath, target.key, { tailLines });
}

/** createdAt may be bumped for sidebar ordering; known messages preserve the actual trace window. */
export function sessionAnalysisTraceSinceMs(session: ClaudeSession | null): number | undefined {
  if (!session) return undefined;
  const timestamps = [session.createdAt, ...session.messages.map(message => message.timestamp)].filter(timestamp => Number.isFinite(timestamp) && timestamp > 0);
  return timestamps.length ? timestamps.reduce((earliest, timestamp) => Math.min(earliest, timestamp), Infinity) - 60_000 : undefined;
}
