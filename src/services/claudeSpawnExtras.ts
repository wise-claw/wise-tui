import {
  parseAssistantRuntimeBundle,
  resolveAssistantRuntime,
  type AssistantBundleItem,
  type AssistantRuntimeBundle,
} from "./assistantPromptLayers";
import { materializeClaudeSpawnMcpConfig } from "./claude";
import type { ClaudeSession } from "../types";
import { resolveSessionProjectRepository } from "../utils/claudeConcurrencyGate";
import type { ProjectItem, Repository } from "../types";

/** 与 Rust `ClaudeSpawnCliExtras` 对齐，透传至 `claude` 子进程 CLI。 */
export interface ClaudeSpawnCliExtras {
  addDirs?: string[];
  allowedTools?: string;
  disallowedTools?: string;
  appendSystemPrompt?: string;
  mcpConfigPath?: string;
  strictMcpConfig?: boolean;
  settingSources?: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** 去掉空字段，避免 IPC 携带无效键。 */
export function compactClaudeSpawnCliExtras(
  extras: ClaudeSpawnCliExtras | null | undefined,
): ClaudeSpawnCliExtras | null {
  if (!extras) return null;
  const addDirs = (extras.addDirs ?? []).map((d) => d.trim()).filter(Boolean);
  const out: ClaudeSpawnCliExtras = {};
  if (addDirs.length > 0) out.addDirs = addDirs;
  if (isNonEmptyString(extras.allowedTools)) out.allowedTools = extras.allowedTools.trim();
  if (isNonEmptyString(extras.disallowedTools)) out.disallowedTools = extras.disallowedTools.trim();
  if (isNonEmptyString(extras.appendSystemPrompt)) {
    out.appendSystemPrompt = extras.appendSystemPrompt.trim();
  }
  if (isNonEmptyString(extras.mcpConfigPath)) out.mcpConfigPath = extras.mcpConfigPath.trim();
  if (extras.strictMcpConfig === true) out.strictMcpConfig = true;
  if (isNonEmptyString(extras.settingSources)) out.settingSources = extras.settingSources.trim();
  return Object.keys(out).length > 0 ? out : null;
}

export function claudeAllowedToolsFromRuntimeTools(tools: string[] | undefined | null): string | undefined {
  const list = (tools ?? []).map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) return undefined;
  return list.join(", ");
}

function enabledBundleItems(bundle: AssistantRuntimeBundle): AssistantBundleItem[] {
  const disabled = new Set(bundle.disabled.map((id) => id.trim()).filter(Boolean));
  const out = new Map<string, AssistantBundleItem>();
  for (const item of bundle.custom) {
    if (!item.id || disabled.has(item.id)) continue;
    out.set(item.id, item);
  }
  return [...out.values()];
}

const MCP_MATERIALIZE_TIMEOUT_MS = 8_000;

async function mcpConfigPathFromAssistantBundle(params: {
  mcpBundleJson: string;
  repositoryPath?: string | null;
}): Promise<string | undefined> {
  const bundle = parseAssistantRuntimeBundle(params.mcpBundleJson);
  const enabled = enabledBundleItems(bundle);
  if (enabled.length === 0) return undefined;
  const serverKeys = enabled.map((item) => item.id.trim()).filter(Boolean);
  const extraConfigPaths = enabled
    .map((item) => item.sourcePath?.trim())
    .filter((p): p is string => Boolean(p));
  try {
    const materializePromise = materializeClaudeSpawnMcpConfig({
      repositoryPath: params.repositoryPath ?? null,
      serverKeys,
      extraConfigPaths,
    });
    const path = await Promise.race([
      materializePromise,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), MCP_MATERIALIZE_TIMEOUT_MS);
      }),
    ]);
    return path ?? undefined;
  } catch {
    return undefined;
  }
}

/** 从助手运行态解析 spawn CLI 扩展（需显式 assistantId）。 */
export async function buildClaudeSpawnExtrasFromAssistantRuntime(scopes: {
  assistantId: string;
  projectId?: string | null;
  repositoryId?: string | number | null;
  repositoryPath?: string | null;
}): Promise<ClaudeSpawnCliExtras | null> {
  const assistantId = scopes.assistantId.trim();
  if (!assistantId) return null;
  try {
    const runtime = await resolveAssistantRuntime({
      assistantId,
      projectId: scopes.projectId ?? null,
      repositoryId: scopes.repositoryId ?? null,
    });
    const mcpConfigPath = await mcpConfigPathFromAssistantBundle({
      mcpBundleJson: runtime.mcpBundleJson,
      repositoryPath: scopes.repositoryPath ?? null,
    });
    return compactClaudeSpawnCliExtras({
      allowedTools: claudeAllowedToolsFromRuntimeTools(runtime.tools),
      appendSystemPrompt: runtime.systemPrompt?.trim() || undefined,
      mcpConfigPath,
    });
  } catch {
    return null;
  }
}

/**
 * 主会话 spawn：按 Cockpit 当前助手 + 会话归属项目/仓库解析 CLI 扩展。
 * 无助手或未解析归属时返回 null（沿用 Claude Code 默认 settings 加载）。
 */
export async function resolveClaudeSpawnExtrasForSession(params: {
  session: Pick<ClaudeSession, "repositoryPath" | "repositoryName">;
  projects: ProjectItem[];
  repositories: Repository[];
  preferredProjectId: string | null;
  activeAssistantId?: string | null;
}): Promise<ClaudeSpawnCliExtras | null> {
  const assistantId = params.activeAssistantId?.trim();
  if (!assistantId) return null;
  const scoped = resolveSessionProjectRepository({
    session: params.session as ClaudeSession,
    projects: params.projects,
    repositories: params.repositories,
    preferredProjectId: params.preferredProjectId,
  });
  return buildClaudeSpawnExtrasFromAssistantRuntime({
    assistantId,
    projectId: scoped?.project.id ?? null,
    repositoryId: scoped?.repository.id ?? null,
    repositoryPath: params.session.repositoryPath?.trim() || null,
  });
}
