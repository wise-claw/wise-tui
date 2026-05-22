import type { ClaudeHostProcess, ClaudeSession, ProjectItem, Repository } from "../../types";
import { sessionUpdatedAt } from "../ProgressMonitorPanel";
import { resolveClaudeProcessWorkspaceLabels } from "../../utils/resolveClaudeProcessWorkspaceLabels";
import { normalizeSearchKeyword } from "../ProgressMonitorPanel";
import {
  HOST_PROCESS_ROW_ID_PREFIX,
  REGISTRY_ORPHAN_ROW_ID_PREFIX,
  parseHostProcessDrawerPid,
  parseRegistryOrphanClaudeSid,
} from "./systemSessions";
import { formatBytes } from "./systemSessions";

export interface ClaudeProcessPopoverCard {
  rowKey: string;
  sessionId: string;
  scopeTitle: string;
  scopeSubtitle: string | null;
  projectName: string | null;
  repositoryName: string | null;
  claudeSessionId: string | null;
  pid: number | null;
  memoryLabel: string | null;
  sourceLabel: string;
  updatedAt: number;
}

function sourceLabelForSession(session: ClaudeSession): string {
  if (session.id.startsWith(HOST_PROCESS_ROW_ID_PREFIX)) {
    return "系统扫描";
  }
  if (session.id.startsWith(REGISTRY_ORPHAN_ROW_ID_PREFIX)) {
    return "注册表";
  }
  return "Wise 标签";
}

function memoryLabelForRow(
  session: ClaudeSession,
  proc: ClaudeHostProcess | undefined,
): string | null {
  if (proc && Number.isFinite(proc.memoryBytes) && proc.memoryBytes > 0) {
    return formatBytes(proc.memoryBytes);
  }
  return null;
}

export function buildClaudeProcessPopoverCard(
  session: ClaudeSession,
  ctx: {
    projects: ReadonlyArray<ProjectItem>;
    repositories: Repository[];
    bindings: Record<string, string>;
    sessions: ClaudeSession[];
    claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
  },
): ClaudeProcessPopoverCard {
  const hostPid = parseHostProcessDrawerPid(session.id);
  const claudeSid = session.claudeSessionId?.trim() || parseRegistryOrphanClaudeSid(session.id) || "";
  let proc =
    hostPid != null ? ctx.claudeProcesses.find((item) => item.pid === hostPid) : undefined;
  if (!proc && claudeSid) {
    proc = ctx.claudeProcesses.find((item) => item.sessionId?.trim() === claudeSid);
  }

  const claudeSessionId = claudeSid || proc?.sessionId?.trim() || null;

  const labels = resolveClaudeProcessWorkspaceLabels({
    session,
    projects: ctx.projects,
    repositories: ctx.repositories,
    bindings: ctx.bindings,
    sessions: ctx.sessions,
    claudeSessionId,
  });

  return {
    rowKey: session.id,
    sessionId: session.id,
    scopeTitle: labels.scopeTitle,
    scopeSubtitle: labels.scopeSubtitle,
    projectName: labels.projectName,
    repositoryName: labels.repositoryName,
    claudeSessionId,
    pid: hostPid ?? proc?.pid ?? null,
    memoryLabel: memoryLabelForRow(session, proc),
    sourceLabel: sourceLabelForSession(session),
    updatedAt: sessionUpdatedAt(session),
  };
}

export function matchClaudeProcessPopoverCard(card: ClaudeProcessPopoverCard, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const hay = [
    card.scopeTitle,
    card.scopeSubtitle,
    card.projectName,
    card.repositoryName,
    card.claudeSessionId,
    card.pid != null ? String(card.pid) : "",
    card.sourceLabel,
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join("\n")
    .toLocaleLowerCase("zh-CN");
  return hay.includes(keyword);
}

export function buildClaudeProcessPopoverCards(
  matchedSessions: ClaudeSession[],
  ctx: {
    projects: ReadonlyArray<ProjectItem>;
    repositories: Repository[];
    bindings: Record<string, string>;
    sessions: ClaudeSession[];
    claudeProcesses: ReadonlyArray<ClaudeHostProcess>;
    searchKeyword: string;
  },
): ClaudeProcessPopoverCard[] {
  const keyword = normalizeSearchKeyword(ctx.searchKeyword);
  return matchedSessions
    .map((session) => buildClaudeProcessPopoverCard(session, ctx))
    .filter((card) => matchClaudeProcessPopoverCard(card, keyword));
}
