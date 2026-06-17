import type {
  FeedbackConfigArtifactKind,
  FeedbackConfigPatchAction,
  FeedbackConfigPatchMcpMeta,
} from "../utils/sessionFeedbackConfigPatch";

/** 深合并 JSON 对象（数组整段替换，对象递归合并）。 */
export function mergeJsonObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    if (
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      existing != null &&
      typeof existing === "object" &&
      !Array.isArray(existing)
    ) {
      out[key] = mergeJsonObjects(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${label} 内容为空`);
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

export function mergeJsonPatchContent(before: string | null, patchJson: string): string {
  const base = before?.trim() ? parseJsonObject(before, "现有 settings") : {};
  const incoming = parseJsonObject(patchJson, "补丁 JSON");
  return `${JSON.stringify(mergeJsonObjects(base, incoming), null, 2)}\n`;
}

export function feedbackConfigPatchBackupRelativePath(repositoryPath: string): string {
  let hash = 0;
  const repo = repositoryPath.trim();
  for (let i = 0; i < repo.length; i += 1) {
    hash = (hash * 31 + repo.charCodeAt(i)) | 0;
  }
  const slug = Math.abs(hash).toString(36);
  return `feedback-patches/${slug}/applies.jsonl`;
}

export interface FeedbackPatchBackupRecord {
  backupId: string;
  at: number;
  repositoryPath: string;
  patchId: string;
  kind: FeedbackConfigArtifactKind;
  action: FeedbackConfigPatchAction;
  path: string;
  rationale: string;
  before: string | null;
  after: string | null;
  mcp?: FeedbackConfigPatchMcpMeta;
  /** MCP 补丁应用前的 enabled 状态 */
  mcpWasEnabled?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMcpMeta(raw: unknown): FeedbackConfigPatchMcpMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const serverName = typeof raw.serverName === "string" ? raw.serverName.trim() : "";
  const scope = typeof raw.scope === "string" ? raw.scope.trim() : "";
  const sourcePath = typeof raw.sourcePath === "string" ? raw.sourcePath.trim() : "";
  if (!serverName || !scope || !sourcePath) return undefined;
  return {
    serverName,
    scope,
    sourcePath,
    claudeJsonProjectKey:
      typeof raw.claudeJsonProjectKey === "string" ? raw.claudeJsonProjectKey : null,
  };
}

export function parseFeedbackPatchBackupLine(line: string): FeedbackPatchBackupRecord | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const raw = JSON.parse(trimmed) as unknown;
    if (!isRecord(raw)) return null;
    const at = typeof raw.at === "number" ? raw.at : 0;
    const patchId = typeof raw.patchId === "string" ? raw.patchId : "";
    const repositoryPath = typeof raw.repositoryPath === "string" ? raw.repositoryPath : "";
    const kind = typeof raw.kind === "string" ? raw.kind : "";
    const action = typeof raw.action === "string" ? raw.action : "";
    const path = typeof raw.path === "string" ? raw.path : "";
    if (!at || !patchId || !repositoryPath || !kind || !action) return null;
    return {
      backupId: typeof raw.backupId === "string" ? raw.backupId : `${at}-${patchId}`,
      at,
      repositoryPath,
      patchId,
      kind: kind as FeedbackConfigArtifactKind,
      action: action as FeedbackConfigPatchAction,
      path,
      rationale: typeof raw.rationale === "string" ? raw.rationale : "",
      before: typeof raw.before === "string" ? raw.before : raw.before === null ? null : null,
      after: typeof raw.after === "string" ? raw.after : raw.after === null ? null : null,
      mcp: parseMcpMeta(raw.mcp),
      mcpWasEnabled: typeof raw.mcpWasEnabled === "boolean" ? raw.mcpWasEnabled : undefined,
    };
  } catch {
    return null;
  }
}

export function parseFeedbackPatchBackupJsonl(text: string): FeedbackPatchBackupRecord[] {
  const records: FeedbackPatchBackupRecord[] = [];
  for (const line of text.split("\n")) {
    const parsed = parseFeedbackPatchBackupLine(line);
    if (parsed) records.push(parsed);
  }
  return records.sort((a, b) => b.at - a.at);
}
