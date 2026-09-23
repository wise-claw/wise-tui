import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { sessionUsesStreamingConnection, type ClaudeSessionConnectionKind } from "../constants/claudeConnection";
import type { ClaudeSession } from "../types";
import { steerCodexTurn } from "./codexRpc";
import { sendStreamingUserMessage } from "./claude";

export type SessionSteeringTarget = { transport: "codex" | "claude-streaming"; sessionId: string };

/** 仅开启当前连接确实支持的通道；ACP prompt 不等于 steering。 */
export function resolveSessionSteeringTarget(
  engine: SessionExecutionEngine,
  session: Pick<ClaudeSession, "id" | "claudeSessionId" | "connectionKind">,
  defaultConnectionKind: ClaudeSessionConnectionKind,
): SessionSteeringTarget | null {
  if (engine === "codex" || engine === "codex-rpc") {
    return { transport: "codex", sessionId: session.id };
  }
  if (engine === "claude" && sessionUsesStreamingConnection(session, defaultConnectionKind)) {
    const sessionId = session.claudeSessionId?.trim();
    if (sessionId) return { transport: "claude-streaming", sessionId };
  }
  return null;
}

export async function sendSessionSteering(target: SessionSteeringTarget, input: string): Promise<void> {
  if (target.transport === "codex") return steerCodexTurn(target.sessionId, undefined, input);
  return sendStreamingUserMessage(target.sessionId, input, { steer: true });
}
