import {
  SESSION_FEEDBACK_LOOP_DISPATCH_KIND_LABELS,
  SESSION_FEEDBACK_LOOP_REPO_MARKER,
} from "../constants/sessionFeedbackLoopDispatch";

export type FeedbackLoopDispatchKind = keyof typeof SESSION_FEEDBACK_LOOP_DISPATCH_KIND_LABELS;

export interface FeedbackLoopWorkerRepositoryNameParts {
  displayBase: string;
  label: string;
}

function stripNestedWorkerMarkers(repositoryName: string): string {
  let name = repositoryName.trim();
  const markers = [SESSION_FEEDBACK_LOOP_REPO_MARKER, "/执行环境:", "/员工:"];
  for (const marker of markers) {
    const idx = name.indexOf(marker);
    if (idx >= 0) name = name.slice(0, idx).trim();
  }
  return name || repositoryName.trim();
}

export function parseFeedbackLoopWorkerRepositoryName(
  repositoryName: string,
): FeedbackLoopWorkerRepositoryNameParts | null {
  const marker = SESSION_FEEDBACK_LOOP_REPO_MARKER;
  const idx = repositoryName.indexOf(marker);
  if (idx < 0) return null;
  const displayBase = repositoryName.slice(0, idx).trim();
  const label = repositoryName.slice(idx + marker.length).trim();
  if (!displayBase || !label) return null;
  return { displayBase, label };
}

export function isFeedbackLoopWorkerRepositoryName(repositoryName: string): boolean {
  return repositoryName.includes(SESSION_FEEDBACK_LOOP_REPO_MARKER);
}

export function buildFeedbackLoopWorkerRepositoryName(
  repositoryDisplayBase: string,
  kind: FeedbackLoopDispatchKind,
  cycleIndex?: number,
): string {
  const base = stripNestedWorkerMarkers(repositoryDisplayBase.trim() || "仓库");
  const kindLabel = SESSION_FEEDBACK_LOOP_DISPATCH_KIND_LABELS[kind];
  const suffix =
    kind === "optimization" && cycleIndex != null && cycleIndex > 0
      ? `${kindLabel}-${cycleIndex}`
      : kindLabel;
  return `${base}${SESSION_FEEDBACK_LOOP_REPO_MARKER}${suffix}`;
}

export function buildFeedbackLoopWorkerUserBubble(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "反馈神经网分析";
  const firstLine = trimmed.split("\n").find((line) => line.trim())?.trim() ?? trimmed;
  if (firstLine.length <= 96) return firstLine;
  return `${firstLine.slice(0, 93)}…`;
}

/** 神经网 oneshot prompt 正文特征（历史会话列表据此隐藏）。 */
export const SESSION_FEEDBACK_LOOP_PROMPT_MARKER = "会话反馈神经网";

export function isSessionFeedbackLoopPromptText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.includes(SESSION_FEEDBACK_LOOP_PROMPT_MARKER);
}

/**
 * 反馈神经网派发的 oneshot 会话：不应出现在「历史会话」列表。
 * 依据 worker 仓库名标记，或首条用户消息 / 磁盘 preview 是否含神经网 prompt。
 */
export function isSessionFeedbackLoopHistorySession(session: {
  messages: ReadonlyArray<{ role: string; content: string }>;
  diskPreview?: string | null;
  repositoryName?: string | null;
}): boolean {
  if (isFeedbackLoopWorkerRepositoryName(session.repositoryName ?? "")) {
    return true;
  }
  const firstUser = session.messages.find((message) => message.role === "user");
  if (firstUser && isSessionFeedbackLoopPromptText(firstUser.content)) {
    return true;
  }
  const diskPreview = session.diskPreview?.trim();
  return Boolean(diskPreview && isSessionFeedbackLoopPromptText(diskPreview));
}
