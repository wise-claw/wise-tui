import type { ClaudeSession } from "../types";
import {
  CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
  CLAUDE_DEFAULT_CONNECTION_KIND_KEY,
  loadDefaultClaudeConnectionKindFromStore,
  saveDefaultClaudeConnectionKindToStore,
  WISE_CLAUDE_CONNECTION_KIND_CHANGED,
  type ClaudeSessionConnectionKind,
} from "../services/wiseDefaultConfigStore";

export type { ClaudeSessionConnectionKind };

export { CLAUDE_DEFAULT_CONNECTION_KIND_KEY, CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK, WISE_CLAUDE_CONNECTION_KIND_CHANGED };

/** 新建主会话标签时的默认连接方式（`app_settings` / `wise.defaultConfig.v1`）。 */
export async function loadDefaultClaudeConnectionKind(): Promise<ClaudeSessionConnectionKind> {
  return loadDefaultClaudeConnectionKindFromStore();
}

export function normalizeClaudeConnectionKind(
  raw: unknown,
  fallback: ClaudeSessionConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
): ClaudeSessionConnectionKind {
  return raw === "oneshot" || raw === "streaming" ? raw : fallback;
}

/** 标签未单独指定 `connectionKind` 时，回退到全局默认（`wise.defaultConfig.v1`）。 */
export function resolveSessionConnectionKind(
  sessionKind: ClaudeSessionConnectionKind | null | undefined,
  defaultKind: ClaudeSessionConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
): ClaudeSessionConnectionKind {
  if (sessionKind === "streaming" || sessionKind === "oneshot") return sessionKind;
  return defaultKind;
}

/** 标签是否显式临时覆盖连接方式（未覆盖则跟随全局默认）。 */
export function isTabConnectionKindOverride(
  sessionKind: ClaudeSessionConnectionKind | null | undefined,
): sessionKind is ClaudeSessionConnectionKind {
  return sessionKind === "streaming" || sessionKind === "oneshot";
}

/** 与全局默认相同则清除覆盖，否则写入本标签临时覆盖。 */
export function applyTabConnectionKindOverride<T extends { connectionKind?: ClaudeSessionConnectionKind }>(
  session: T,
  picked: ClaudeSessionConnectionKind,
  globalDefault: ClaudeSessionConnectionKind,
): T {
  if (picked === globalDefault) {
    if (!isTabConnectionKindOverride(session.connectionKind)) return session;
    const { connectionKind: _omit, ...rest } = session;
    return rest as T;
  }
  return { ...session, connectionKind: picked };
}

export function sessionUsesStreamingConnection(
  session: Pick<ClaudeSession, "connectionKind"> | null | undefined,
  fallback: ClaudeSessionConnectionKind = CLAUDE_DEFAULT_CONNECTION_KIND_FALLBACK,
): boolean {
  return resolveSessionConnectionKind(session?.connectionKind, fallback) === "streaming";
}

export async function saveDefaultClaudeConnectionKind(
  kind: ClaudeSessionConnectionKind,
): Promise<void> {
  await saveDefaultClaudeConnectionKindToStore(kind);
}

// ────────────────────────────────────────────────────────────────────────────
// Per-session ultracode override（OMC ultracode 模式）
//
// 镜像 `connectionKind` 的「per-session override > global default」合并范式：
// - `undefined`/`null` = 未设置，follow global `claudeDefaultSettings.ultracodeEnabled`
// - `true` / `false` = per-session 显式 override（覆盖 global）
//
// 优先级：per-session false beats global true（per-session 永远赢）。
// ────────────────────────────────────────────────────────────────────────────

/** 标签是否显式临时覆盖 ultracode 开关（未覆盖则跟随全局默认）。 */
export function isTabUltracodeOverride(
  session: Pick<ClaudeSession, "ultracodeEnabled"> | null | undefined,
): boolean {
  return typeof session?.ultracodeEnabled === "boolean";
}

/** per-session ultracode 是否实际生效（含全局兜底）。 */
export function isSessionUltracodeActive(
  session: Pick<ClaudeSession, "ultracodeEnabled"> | null | undefined,
  globalEnabled: boolean,
): boolean {
  if (typeof session?.ultracodeEnabled === "boolean") return session.ultracodeEnabled;
  return globalEnabled;
}

/**
 * 写入/清除 per-session ultracode override。
 * - `next === null` → 清除覆盖（回到跟随全局）；
 * - `next === boolean` → 显式设置。
 * 当 `next === null` 且原本就没有 override 时，原对象引用保持不变（避免无谓重渲染）。
 */
export function applyTabUltracodeOverride<T extends { ultracodeEnabled?: boolean }>(
  session: T,
  next: boolean | null,
): T {
  if (next === null) {
    if (!isTabUltracodeOverride(session)) return session;
    const { ultracodeEnabled: _omit, ...rest } = session;
    return rest as T;
  }
  return { ...session, ultracodeEnabled: next };
}

export const CLAUDE_CONNECTION_KIND_LABELS: Record<
  ClaudeSessionConnectionKind,
  { title: string; description: string }
> = {
  oneshot: {
    title: "逐轮处理",
    description: "每条用户消息拉起新的 claude -p 子进程；适合编排与批量任务。",
  },
  streaming: {
    title: "长驻会话",
    description:
      "单标签保持一个 Claude 子进程，经 stream-json 多轮对话；Wise 全局默认，MCP、Skills、Hooks、子代理与终端 CLI 更接近。",
  },
};
