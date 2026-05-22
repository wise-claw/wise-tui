import type { ClaudeSession } from "../types";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

/** 配置中心保存默认连接方式后派发，供 `useClaudeSessions` 热更新新建标签默认值。 */
export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

/** 新建主会话标签时的默认连接方式（可被用户设置覆盖）。 */
export async function loadDefaultClaudeConnectionKind(): Promise<ClaudeSessionConnectionKind> {
  try {
    const raw = await getAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY);
    return raw?.trim() === "oneshot" ? "oneshot" : "streaming";
  } catch {
    return "streaming";
  }
}

export function normalizeClaudeConnectionKind(
  raw: unknown,
  fallback: ClaudeSessionConnectionKind = "streaming",
): ClaudeSessionConnectionKind {
  return raw === "oneshot" || raw === "streaming" ? raw : fallback;
}

export function sessionUsesStreamingConnection(
  session: Pick<ClaudeSession, "connectionKind"> | null | undefined,
  fallback: ClaudeSessionConnectionKind = "streaming",
): boolean {
  return normalizeClaudeConnectionKind(session?.connectionKind, fallback) === "streaming";
}

export async function saveDefaultClaudeConnectionKind(
  kind: ClaudeSessionConnectionKind,
): Promise<void> {
  const normalized = normalizeClaudeConnectionKind(kind);
  await setAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY, normalized);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(WISE_CLAUDE_CONNECTION_KIND_CHANGED, { detail: { kind: normalized } }),
    );
  }
}

export const CLAUDE_CONNECTION_KIND_LABELS: Record<
  ClaudeSessionConnectionKind,
  { title: string; description: string }
> = {
  streaming: {
    title: "长驻会话（推荐）",
    description:
      "单标签保持一个 Claude 子进程，经 stream-json 多轮对话；MCP、Skills、Hooks、子代理与终端 CLI 更接近。",
  },
  oneshot: {
    title: "逐轮独立进程",
    description: "每条用户消息拉起新的 claude -p 子进程；适合编排、批量任务或与旧行为对齐。",
  },
};
