import type { ClaudeSession } from "../types";
import { TEAM_AUTO_DRIVER_PREFIXES } from "../constants/teamAutoDriver";
import { isProjectRootSessionDisplayName, normalizeRepositoryPathKey } from "./repositoryMainSessionBinding";
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

/** 侧栏/启动恢复用：有正文、磁盘 id 或预览的会话优先于空壳新标签。 */
export function sessionHasRecoverableChatHistory(session: ClaudeSession): boolean {
  if ((session.messages?.length ?? 0) > 0) return true;
  if (session.claudeSessionId?.trim()) return true;
  if (session.diskPreview?.trim()) return true;
  return false;
}

function sessionActivityScore(session: ClaudeSession): number {
  const ts = session.messages[session.messages.length - 1]?.timestamp ?? session.createdAt;
  let score = Number.isFinite(ts) ? ts : 0;
  if ((session.messages?.length ?? 0) > 0) score += 1_000_000_000_000;
  else if (session.claudeSessionId?.trim()) score += 100_000_000_000;
  else if (session.diskPreview?.trim()) score += 10_000_000_000;
  return score;
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

export interface PickSessionForRepositorySidebarOptions {
  /** 与 `…/员工:名称` 中名称一致时，优先将该子代理会话视为仓库「主」会话。 */
  mainOwnerAgentName?: string | null;
}

function pickBestByLatestActivity(pool: ClaudeSession[]): ClaudeSession | null {
  let best: ClaudeSession | null = null;
  let bestScore = -Infinity;
  for (const s of pool) {
    const score = sessionActivityScore(s);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

/**
 * 侧栏选择仓库后应打开的会话：
 * - 若配置了主 Owner 智能体名：优先同路径下该 `员工:` 子会话，否则回退到人类主会话（无员工段）逻辑；
 * - 未配置：同路径下排除「员工:」子会话，在其余中优先非团队流程态，再按最近活动时间取一条。
 */
export function pickSessionForRepositorySidebarSelect(
  sessions: ClaudeSession[],
  repositoryPath: string,
  ownerHints: Record<string, SessionOwnerHint>,
  options?: PickSessionForRepositorySidebarOptions,
): ClaudeSession | null {
  const repoKey = normalizeRepositoryPathKey(repositoryPath);
  const mainAgent = options?.mainOwnerAgentName?.trim();
  if (mainAgent) {
    const agentCandidates = sessions.filter((s) => {
      if (normalizeRepositoryPathKey(s.repositoryPath) !== repoKey) return false;
      if (isProjectRootSessionDisplayName(s.repositoryName ?? "")) return false;
      return extractBoundEmployeeNameFromDisplay(s.repositoryName ?? "") === mainAgent;
    });
    if (agentCandidates.length > 0) {
      const preferred = agentCandidates.filter((s) => !shouldDeprioritizeForRepositoryMainFocus(s, ownerHints));
      const pool = preferred.length > 0 ? preferred : agentCandidates;
      const picked = pickBestByLatestActivity(pool);
      if (picked) return picked;
    }
  }

  const candidates = sessions.filter(
    (s) =>
      normalizeRepositoryPathKey(s.repositoryPath) === repoKey &&
      !extractBoundEmployeeNameFromDisplay(s.repositoryName ?? "") &&
      !isProjectRootSessionDisplayName(s.repositoryName ?? ""),
  );
  if (candidates.length === 0) {
    return null;
  }
  const preferred = candidates.filter((s) => !shouldDeprioritizeForRepositoryMainFocus(s, ownerHints));
  const pool = preferred.length > 0 ? preferred : candidates;
  return pickBestByLatestActivity(pool);
}

/** 侧栏点项目行：只恢复展示名为 `Project: …` 的项目主会话（不与仓库主会话混用）。 */
export function pickProjectMainSessionForSidebarSelect(
  sessions: ClaudeSession[],
  repositoryPath: string,
  ownerHints: Record<string, SessionOwnerHint>,
): ClaudeSession | null {
  const repoKey = normalizeRepositoryPathKey(repositoryPath);
  const candidates = sessions.filter(
    (s) =>
      normalizeRepositoryPathKey(s.repositoryPath) === repoKey &&
      isProjectRootSessionDisplayName(s.repositoryName ?? "") &&
      !extractBoundEmployeeNameFromDisplay(s.repositoryName ?? ""),
  );
  if (candidates.length === 0) {
    return null;
  }
  const preferred = candidates.filter((s) => !shouldDeprioritizeForRepositoryMainFocus(s, ownerHints));
  const pool = preferred.length > 0 ? preferred : candidates;
  return pickBestByLatestActivity(pool);
}
