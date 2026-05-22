import type { ClaudeSession } from "../types";
import { getAppSetting, setAppSetting } from "../services/appSettingsStore";

export type ClaudeSessionConnectionKind = NonNullable<ClaudeSession["connectionKind"]>;

export const CLAUDE_DEFAULT_CONNECTION_KIND_KEY = "wise.claudeDefaultConnectionKind.v1";

/** 未入库或无效值时的默认连接方式。 */
export const CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK: ClaudeSessionConnectionKind = "oneshot";

/** 配置中心保存默认连接方式后派发，供 `useClaudeSessions` 热更新新建标签默认值。 */
export const WISE_CLAUDE_CONNECTION_KIND_CHANGED = "wise:claude-connection-kind-changed";

/** 新建主会话标签时的默认连接方式（可被用户设置覆盖）。 */
export async function loadDefaultClaudeConnectionKind(): Promise<ClaudeSessionConnectionKind> {
  try {
    const raw = (await getAppSetting(CLAUDE_DEFAULT_CONNECTION_KIND_KEY))?.trim();
    if (raw === "streaming" || raw === "oneshot") return raw;
    return CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK;
  } catch {
    return CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK;
  }
}

export function normalizeClaudeConnectionKind(
  raw: unknown,
  fallback: ClaudeSessionConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
): ClaudeSessionConnectionKind {
  return raw === "oneshot" || raw === "streaming" ? raw : fallback;
}

export function sessionUsesStreamingConnection(
  session: Pick<ClaudeSession, "connectionKind"> | null | undefined,
  fallback: ClaudeSessionConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
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
    title: "长驻会话",
    description:
      "单标签保持一个 Claude 子进程，经 stream-json 多轮对话；MCP、Skills、Hooks、子代理与终端 CLI 更接近。",
  },
  oneshot: {
    title: "逐轮处理",
    description: "每条用户消息拉起新的 claude -p 子进程；全局默认，适合编排与批量任务。",
  },
};
