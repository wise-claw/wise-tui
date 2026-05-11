import type { ClaudeSession } from "../types";
import { TEAM_AUTO_DRIVER_PREFIXES } from "../constants/teamAutoDriver";
import {
  extractBoundEmployeeNameFromDisplay,
  resolveOwnerHintForSession,
  type SessionOwnerHint,
} from "./sessionOwnerHints";

function getLatestUserPlainTextFromSession(session: ClaudeSession): string {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const msg = session.messages[i];
    if (msg.role !== "user") {
      continue;
    }
    const fromParts =
      msg.parts
        ?.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n\n") ?? "";
    if (fromParts) {
      return fromParts;
    }
    const fromContent = msg.content.trim();
    if (fromContent) {
      return fromContent;
    }
  }
  return "";
}

function isTeamAutoDriverLatestUserSession(session: ClaudeSession): boolean {
  const t = getLatestUserPlainTextFromSession(session);
  return TEAM_AUTO_DRIVER_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/** 侧栏点仓库名时要尽量避开：团队 owner 标记、或最新用户消息为团队自动调度前缀的会话。 */
function shouldDeprioritizeForRepositoryMainFocus(
  session: ClaudeSession,
  ownerHints: Record<string, SessionOwnerHint>,
): boolean {
  const hint = resolveOwnerHintForSession(ownerHints, session);
  if (hint?.type === "team") {
    return true;
  }
  return isTeamAutoDriverLatestUserSession(session);
}

/**
 * 侧栏选择仓库后应打开的会话：同一路径下排除「员工:」绑定子会话；在其余会话中优先非团队流程态，再按最近活动时间取一条。
 */
export function pickSessionForRepositorySidebarSelect(
  sessions: ClaudeSession[],
  repositoryPath: string,
  ownerHints: Record<string, SessionOwnerHint>,
): ClaudeSession | null {
  const candidates = sessions.filter(
    (s) => s.repositoryPath === repositoryPath && !extractBoundEmployeeNameFromDisplay(s.repositoryName ?? ""),
  );
  if (candidates.length === 0) {
    return null;
  }
  const preferred = candidates.filter((s) => !shouldDeprioritizeForRepositoryMainFocus(s, ownerHints));
  const pool = preferred.length > 0 ? preferred : candidates;

  let best: ClaudeSession | null = null;
  let bestTs = -Infinity;
  for (const s of pool) {
    const ts = s.messages[s.messages.length - 1]?.timestamp ?? s.createdAt;
    if (ts > bestTs) {
      bestTs = ts;
      best = s;
    }
  }
  return best;
}
