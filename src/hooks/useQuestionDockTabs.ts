import { useMemo, useSyncExternalStore } from "react";
import type { ClaudeSession, QuestionRequest } from "../types";
import type { ControlRequestStatus } from "../notifications/types";
import { notificationHub } from "../notifications/hub";
import {
  extractBoundEmployeeNameFromDisplay,
  resolveOwnerHintForSession,
  type SessionOwnerHint,
} from "../utils/sessionOwnerHints";

export interface QuestionDockTabSpec {
  tabKey: string;
  ownerSessionId: string;
  question: QuestionRequest;
  queueLength: number;
  status: ControlRequestStatus | null;
  error: string | null;
  arrivedAt: number;
  tabTitle: string;
  /** 仅展示时间，会话 id 不写入文案 */
  tabSubtitle: string;
  sortTier: number;
}

function normRepo(p: string): string {
  return p.trim().replace(/\\/g, "/");
}

function classifyTab(sess: ClaudeSession, hints: Record<string, SessionOwnerHint>): { sortTier: number; tabTitle: string } {
  const hint = resolveOwnerHintForSession(hints, sess);
  if (hint?.type === "team") {
    return { sortTier: 20, tabTitle: `团队 · ${hint.name}` };
  }
  if (hint?.type === "employee") {
    return { sortTier: 10, tabTitle: `员工 · ${hint.name}` };
  }
  const emp = extractBoundEmployeeNameFromDisplay(sess.repositoryName ?? "");
  if (emp) {
    return { sortTier: 10, tabTitle: `员工 · ${emp}` };
  }
  return { sortTier: 0, tabTitle: "主会话" };
}

function formatDockTabTime(ms: number): string {
  try {
    return new Date(ms).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return "";
  }
}

/**
 * 同仓库内所有仍有队首 AskUserQuestion 的标签（主/员工/团队），用于 Composer 多 Tabs。
 */
export function useQuestionDockTabsForRepository(
  viewerSession: ClaudeSession,
  allSessions: ClaudeSession[],
  sessionOwnerHints: Record<string, SessionOwnerHint>,
): QuestionDockTabSpec[] {
  const gen = useSyncExternalStore(notificationHub.subscribe, notificationHub.getVersion, notificationHub.getVersion);
  return useMemo(() => {
    void gen;
    const path = normRepo(viewerSession.repositoryPath ?? "");
    if (!path || allSessions.length === 0) return [];
    const entries = notificationHub.listHeadQuestionDockEntries();
    const specs: QuestionDockTabSpec[] = [];
    for (const e of entries) {
      const sess = allSessions.find((s) => s.id === e.ownerSessionId || s.claudeSessionId === e.ownerSessionId);
      if (!sess || normRepo(sess.repositoryPath) !== path) continue;
      const slice = notificationHub.getDockSlice(e.ownerSessionId);
      if (slice.questionRequest?.id !== e.question.id) continue;
      const life = notificationHub.getRequestLifecycle(e.question.id);
      const st = (life?.status ?? null) as ControlRequestStatus | null;
      const err = life?.status === "failed" ? life.lastError ?? null : null;
      const { sortTier, tabTitle } = classifyTab(sess, sessionOwnerHints);
      const arrivedAt = life?.createdAt ?? Date.now();
      const tabSubtitle = formatDockTabTime(arrivedAt);
      specs.push({
        tabKey: `${e.ownerSessionId}:${e.question.id}`,
        ownerSessionId: e.ownerSessionId,
        question: e.question,
        queueLength: slice.questionRequestQueue.length,
        status: st,
        error: err,
        arrivedAt,
        tabTitle,
        tabSubtitle,
        sortTier,
      });
    }
    specs.sort((a, b) => {
      if (a.sortTier !== b.sortTier) return a.sortTier - b.sortTier;
      const t = a.tabTitle.localeCompare(b.tabTitle, "zh-CN");
      if (t !== 0) return t;
      return b.arrivedAt - a.arrivedAt;
    });
    return specs;
  }, [gen, viewerSession.repositoryPath, viewerSession.id, allSessions, sessionOwnerHints]);
}
