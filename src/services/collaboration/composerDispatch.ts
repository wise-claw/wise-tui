import type { CollabDispatchMode, CollabDispatchResult, CollabEffectiveConfigManifest, CollabSpawnConfig } from "../../types/collaboration";
import { launchCollabDiscussion } from "../../stores/collabUiStore";
import { normalizeCollabError } from "./errors";
import { dispatchCollabIntent, newCollabRequestId } from "./ipc";

const MAX_ATTEMPTS = 3;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 校验 Rust 讨论负载；缺字段时返回 null。 */
export function parseCollabDiscussionPayload(
  raw: unknown,
): { repositoryPath: string; prompt: string; spawn: CollabSpawnConfig; manifest: CollabEffectiveConfigManifest | null } | null {
  if (!isRecord(raw)) return null;
  const repositoryPath = typeof raw.repositoryPath === "string" ? raw.repositoryPath.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  if (!repositoryPath || !prompt.trim() || !isRecord(raw.spawn)) return null;
  const spawn = raw.spawn as unknown as CollabSpawnConfig;
  if (!Array.isArray(spawn.addDirs) || !Array.isArray(spawn.mcpServerKeys)) return null;
  return {
    repositoryPath,
    prompt,
    spawn,
    manifest: isRecord(raw.manifest) ? (raw.manifest as unknown as CollabEffectiveConfigManifest) : null,
  };
}

export interface ComposerCollabDispatchInput {
  originSessionId: string;
  agentId: string;
  agentName: string;
  mode: CollabDispatchMode;
  body: string;
  requirementId: string | null;
  projectContext?: string | null;
  attachments?: string[];
}

export interface ComposerCollabDispatchOutcome {
  result: CollabDispatchResult;
  discussionSessionId: string | null;
}

/**
 * 输入框派发：一次发送固定一个 requestId，网络/存储类可重试错误用同一 requestId 重投，
 * 由 Rust 幂等表返回同一需求，避免重复建需求。
 */
export async function dispatchComposerToCollabAgent(input: ComposerCollabDispatchInput): Promise<ComposerCollabDispatchOutcome> {
  const requestId = newCollabRequestId("intent");
  let lastError: unknown = null;
  let result: CollabDispatchResult | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !result; attempt += 1) {
    try {
      result = await dispatchCollabIntent({
        requestId,
        agentId: input.agentId,
        mode: input.mode,
        body: input.body,
        requirementId: input.requirementId,
        projectContext: input.projectContext ?? null,
        originSessionId: input.originSessionId,
        attachments: input.attachments ?? [],
      });
    } catch (e) {
      lastError = e;
      const err = normalizeCollabError(e);
      if (!err.retryable && err.code !== "STORAGE_ERROR") break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  if (!result) throw lastError ?? new Error("派发失败");

  let discussionSessionId: string | null = null;
  if (result.mode === "discuss") {
    const payload = parseCollabDiscussionPayload(result.discussion);
    if (!payload) throw new Error("讨论配置无效：智能体没有可读取的仓库");
    discussionSessionId = await launchCollabDiscussion({
      agentId: input.agentId,
      agentName: input.agentName,
      originSessionId: input.originSessionId,
      ...payload,
    });
  }
  return { result, discussionSessionId };
}
