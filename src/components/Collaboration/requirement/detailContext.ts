import type { ProjectItem, Repository } from "../../../types";
import type { CollabAgentSummary, CollabRequirementSnapshot, CollabTask } from "../../../types/collaboration";

export interface CollabDetailContext {
  snapshot: CollabRequirementSnapshot;
  agents: CollabAgentSummary[];
  repositories: Repository[];
  projects: ProjectItem[];
  reload: () => void;
}

export function repoName(repositories: Repository[], id: number | null | undefined): string {
  if (id == null) return "规划 / 跨仓库";
  return repositories.find((r) => r.id === id)?.name ?? `仓库 #${id}`;
}

export function repoPath(repositories: Repository[], id: number | null | undefined): string | null {
  if (id == null) return null;
  return repositories.find((r) => r.id === id)?.path ?? null;
}

export function agentName(agents: CollabAgentSummary[], id: string | null | undefined): string {
  if (!id) return "未指定";
  return agents.find((a) => a.id === id)?.name ?? id;
}

export function taskTitle(tasks: CollabTask[], id: string | null | undefined): string {
  if (!id) return "—";
  return tasks.find((t) => t.id === id)?.title ?? id.slice(0, 12);
}

export function projectName(projects: ProjectItem[], id: string | null | undefined): string {
  if (!id) return "—";
  return projects.find((p) => p.id === id)?.name ?? id;
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} 分钟`;
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`;
}

/** 只提取字符串 / 数字字段做一行展示，避免渲染不可信的嵌套结构。 */
export function shortFields(value: unknown, keys: string[]): string {
  if (typeof value !== "object" || value === null) return typeof value === "string" ? value : "";
  const rec = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (typeof v === "number") parts.push(String(v));
  }
  return parts.join(" · ");
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
