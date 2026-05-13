import type { ClaudeSession, ClaudeSessionInfo } from "../../types";

export const REGISTRY_ORPHAN_ROW_ID_PREFIX = "__wise_registry_orphan__:" as const;

export function parseRegistryOrphanClaudeSid(drawerSessionId: string): string | null {
  if (!drawerSessionId.startsWith(REGISTRY_ORPHAN_ROW_ID_PREFIX)) return null;
  const raw = drawerSessionId.slice(REGISTRY_ORPHAN_ROW_ID_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

export function buildRegistryOrphanClaudeSession(info: ClaudeSessionInfo): ClaudeSession {
  const sid = info.session_id.trim();
  const startedMs = Date.parse(info.started_at);
  const createdAt = Number.isFinite(startedMs) ? startedMs : Date.now();
  const path = info.project_path.trim();
  const normalizedPath = path.replace(/\\/g, "/");
  const repoName =
    normalizedPath.length > 0
      ? (normalizedPath.split("/").filter(Boolean).pop() ?? path)
      : "外部进程";
  const model = info.model.trim();
  return {
    id: `${REGISTRY_ORPHAN_ROW_ID_PREFIX}${sid}`,
    claudeSessionId: sid,
    repositoryPath: path.length > 0 ? path : "—",
    repositoryName: repoName,
    model: model.length > 0 ? model : "—",
    status: "running",
    messages: [],
    createdAt,
    pendingPrompt: "",
    diskPreview: path.length > 0 ? path : `Claude · ${sid.length > 10 ? `${sid.slice(0, 8)}…` : sid}`,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)}GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}MB`;
}
