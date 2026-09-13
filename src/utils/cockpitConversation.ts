import type { GitStatusResponse } from "../types";
import type { AssistantEntry } from "../types/assistant";

export type CockpitRunStatus = "running" | "ok" | "failed";

export interface CockpitConversationRecord {
  id: string;
  assistantId: string;
  assistantName: string;
  sessionId: string | null;
  repositoryPath: string;
  repositoryName: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  promptPreview: string;
  createdAt: number;
  updatedAt: number;
  status: CockpitRunStatus;
  artifactPaths: string[];
}

export function cockpitConversationTitle(prompt: string, fallback = "未命名请求"): string {
  const line = prompt
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!line) return fallback;
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

export function cockpitPromptPreview(prompt: string, max = 160): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function collectGitChangedPaths(
  status: Pick<GitStatusResponse, "staged" | "unstaged">,
): string[] {
  const paths = [...status.staged, ...status.unstaged]
    .map((file) => file.path.trim())
    .filter(Boolean);
  return [...new Set(paths)].sort();
}

export function pickDefaultCockpitAssistant(
  assistants: Array<Pick<AssistantEntry, "id">>,
  lastAssistantId?: string | null,
): string | null {
  const last = lastAssistantId?.trim() ?? "";
  if (last && assistants.some((item) => item.id === last)) return last;
  return assistants[0]?.id ?? null;
}

export function parseCockpitConversationRecord(raw: unknown): CockpitConversationRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id.trim()) return null;
  if (typeof o.assistantId !== "string" || !o.assistantId.trim()) return null;
  if (typeof o.assistantName !== "string") return null;
  if (typeof o.repositoryPath !== "string") return null;
  if (typeof o.createdAt !== "number" || typeof o.updatedAt !== "number") return null;
  const status: CockpitRunStatus =
    o.status === "ok" || o.status === "failed" || o.status === "running" ? o.status : "ok";
  const artifactPaths = Array.isArray(o.artifactPaths)
    ? [...new Set(o.artifactPaths.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort()
    : [];
  return {
    id: o.id.trim(),
    assistantId: o.assistantId.trim(),
    assistantName: o.assistantName.trim() || o.assistantId.trim(),
    sessionId: typeof o.sessionId === "string" && o.sessionId.trim() ? o.sessionId.trim() : null,
    repositoryPath: o.repositoryPath.trim(),
    repositoryName: typeof o.repositoryName === "string" ? o.repositoryName.trim() : "",
    projectId: typeof o.projectId === "string" && o.projectId.trim() ? o.projectId.trim() : null,
    projectName: typeof o.projectName === "string" && o.projectName.trim() ? o.projectName.trim() : null,
    title: typeof o.title === "string" && o.title.trim() ? o.title.trim() : "未命名请求",
    promptPreview: typeof o.promptPreview === "string" ? o.promptPreview : "",
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    status,
    artifactPaths,
  };
}

export function formatCockpitRunStatusLabel(status: CockpitRunStatus): string {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "已完成";
}
