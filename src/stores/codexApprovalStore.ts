/**
 * Codex RPC 审批请求会话级 store。
 *
 * `codex-rpc:approval-request` 事件由本 store 单点订阅，按 session_id 分发给各 Composer dock，
 * 避免全局 Modal；对齐 Claude Code AskUserQuestion / PermissionDock 的输入区上方放置。
 */

import {
  onCodexApprovalRequest,
  onCodexApprovalResolved,
  respondCodexApproval,
  type CodexApprovalRequestPayload,
} from "../services/codexRpc";
import {
  getAppSetting,
  WISE_CODEX_DEFAULT_SETTINGS_KEY,
} from "../services/appSettingsStore";
import { isFullAccessInCodexSettings } from "../components/DefaultConfigPanel/codexDefaultSettings";
import { isTauriIpcAlive } from "../utils/tauriEnv";

type Listener = () => void;

const pendingBySession = new Map<string, CodexApprovalRequestPayload>();
const listeners = new Set<Listener>();

let listening = false;
let listenPromise: Promise<void> | null = null;
let unlistenRequest: (() => void) | undefined;
let unlistenResolved: (() => void) | undefined;

/**
 * 完全访问（danger-full-access + never）下仍需 Wise 自动应答的审批类型。
 *
 * codex app-server 0.149 对 `thread/start.config` 的 `sandbox_mode` / `approval_policy`
 * 并不总是生效（实测 workspace-write + on-request 下越界写命令仍直接执行、不发审批），
 * 因此即使选择了「完全访问」，命令执行/文件变更审批请求仍可能到达 Wise。
 * 这里在 Wise 侧直接回 `acceptForSession`，与用户显式选择保持一致，不再弹审批坞栏。
 *
 * 仅自动应答 commandExecution / fileChange；unknown 等未知类型保留人工 dock 兜底。
 */
const FULL_ACCESS_AUTO_APPROVE_TYPES: ReadonlySet<string> = new Set([
  "commandExecution",
  "fileChange",
]);

/**
 * 纯决策：给定全局 codex 默认设置文本与审批类型，是否应自动批准。
 * 供 store 监听与单元测试复用。
 */
export function shouldAutoApproveFullAccessCodexRequest(
  settingsText: string,
  type: CodexApprovalRequestPayload["type"],
): boolean {
  if (!FULL_ACCESS_AUTO_APPROVE_TYPES.has(type)) return false;
  return isFullAccessInCodexSettings(settingsText);
}

/**
 * 完全访问开启时，对 codex 审批请求直接回 acceptForSession（不落 pending、不弹 dock）。
 * 返回是否已自动处理；读取失败 / 非完全访问时返回 false，走原有人工审批。
 */
async function autoApproveFullAccessIfNeeded(
  payload: CodexApprovalRequestPayload,
): Promise<boolean> {
  if (!FULL_ACCESS_AUTO_APPROVE_TYPES.has(payload.type)) return false;
  if (!isTauriIpcAlive()) return false;
  try {
    const stored = await getAppSetting(WISE_CODEX_DEFAULT_SETTINGS_KEY);
    if (!isFullAccessInCodexSettings(stored ?? "")) return false;
  } catch {
    return false;
  }
  void respondCodexApproval(payload.session_id, payload.request_id, "acceptForSession").catch(
    (err) => {
      console.warn("[wise:codex-approval] 完全访问自动批准失败", err);
    },
  );
  return true;
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.warn("[wise:codex-approval] listener threw", err);
    }
  }
}

function setPending(payload: CodexApprovalRequestPayload): void {
  const sid = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  if (!sid) return;
  pendingBySession.set(sid, payload);
  notify();
}

function clearPending(sessionId: string, requestId: number): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const current = pendingBySession.get(sid);
  if (!current || current.request_id !== requestId) return;
  pendingBySession.delete(sid);
  notify();
}

async function startListening(): Promise<void> {
  if (listening) return;
  if (!isTauriIpcAlive()) return;
  listening = true;
  try {
    unlistenRequest = await onCodexApprovalRequest(async (payload) => {
      if (await autoApproveFullAccessIfNeeded(payload)) return;
      setPending(payload);
    });
    unlistenResolved = await onCodexApprovalResolved((payload) => {
      clearPending(payload.session_id, payload.request_id);
    });
  } catch (err) {
    listening = false;
    console.warn("[wise:codex-approval] failed to attach listeners", err);
  }
}

/** App 启动或首个订阅者挂载时调用；幂等。 */
export function ensureCodexApprovalListening(): void {
  if (listening || listenPromise) return;
  listenPromise = startListening().finally(() => {
    listenPromise = null;
  });
}

export function subscribeCodexApproval(listener: Listener): () => void {
  listeners.add(listener);
  ensureCodexApprovalListening();
  return () => {
    listeners.delete(listener);
  };
}

/** 读取某会话当前待审批请求（无则 null）。 */
export function getCodexApprovalPending(sessionId: string): CodexApprovalRequestPayload | null {
  const sid = sessionId.trim();
  if (!sid) return null;
  return pendingBySession.get(sid) ?? null;
}

/**
 * 用户已成功回包后本地先行清掉 dock（不必等 approval-resolved 事件）。
 * requestId 不匹配时 no-op，避免清掉更新的请求。
 */
export function dismissCodexApprovalPending(sessionId: string, requestId: number): void {
  clearPending(sessionId, requestId);
}

/** 测试用：直接写入 pending（不经过 Tauri 事件）。 */
export function __setCodexApprovalPendingForTests(
  payload: CodexApprovalRequestPayload | null,
  sessionId = "sess-1",
): void {
  const sid = sessionId.trim();
  if (!sid) return;
  if (payload) {
    pendingBySession.set(sid, payload);
  } else {
    pendingBySession.delete(sid);
  }
  notify();
}

/** 测试用：重置内存状态与监听标记。 */
export function __resetCodexApprovalStoreForTests(): void {
  pendingBySession.clear();
  listeners.clear();
  unlistenRequest?.();
  unlistenResolved?.();
  unlistenRequest = undefined;
  unlistenResolved = undefined;
  listening = false;
  listenPromise = null;
}
