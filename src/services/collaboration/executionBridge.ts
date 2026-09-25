import type { ClaudeSpawnCliExtras } from "../claudeSpawnExtras";
import type { CollabFinishOutcome, CollabSpawnConfig } from "../../types/collaboration";

/** 与 `ClaudeSession.status` 对齐。 */
export type CollabObservedSessionStatus = "idle" | "connecting" | "running" | "completed" | "cancelled" | "error";

export const COLLAB_HEARTBEAT_INTERVAL_MS = 30_000;
export const COLLAB_CLAIM_INTERVAL_MS = 5_000;
export const COLLAB_LEASE_OWNER_PREFIX = "wise-ui";

function nonEmpty(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** 协作任务的 spawn 配置 → Claude CLI 扩展；智能体配置完全替代助手层，不与 Cockpit 助手叠加。 */
export function collabSpawnToCliExtras(spawn: CollabSpawnConfig, mcpConfigPath?: string | null): ClaudeSpawnCliExtras {
  const out: ClaudeSpawnCliExtras = {};
  const addDirs = spawn.addDirs.map((d) => d.trim()).filter(Boolean);
  if (addDirs.length) out.addDirs = addDirs;
  const allowed = nonEmpty(spawn.allowedTools);
  if (allowed) out.allowedTools = allowed;
  const disallowed = nonEmpty(spawn.disallowedTools);
  if (disallowed) out.disallowedTools = disallowed;
  const prompt = nonEmpty(spawn.appendSystemPrompt);
  if (prompt) out.appendSystemPrompt = prompt;
  const mcp = nonEmpty(mcpConfigPath);
  if (mcp) out.mcpConfigPath = mcp;
  if (spawn.strictMcpConfig) out.strictMcpConfig = true;
  const sources = nonEmpty(spawn.settingSources);
  if (sources) out.settingSources = sources;
  return out;
}

export function collabSpawnNeedsMcpMaterialize(spawn: CollabSpawnConfig): boolean {
  return spawn.mcpServerKeys.length > 0 || spawn.mcpExtraConfigPaths.length > 0;
}

/**
 * 会话状态变化 → 尝试结束结果；返回 null 表示仍在进行。
 * `sawRunning`：会话曾进入 running，避免把尚未开始的 idle 误判为完成。
 */
export function decideCollabSessionOutcome(
  next: CollabObservedSessionStatus | null | undefined,
  sawRunning: boolean,
): CollabFinishOutcome | null {
  if (next == null) return "session_lost";
  switch (next) {
    case "error":
      return "error";
    case "cancelled":
      return "stopped";
    case "completed":
      return "completed";
    case "idle":
      return sawRunning ? "completed" : null;
    default:
      return null;
  }
}

/** 启动核对：UI 中会话的观测结果。 */
export function observeCollabSession(
  status: CollabObservedSessionStatus | null | undefined,
): "running" | "idle" | "missing" {
  if (status == null) return "missing";
  if (status === "running" || status === "connecting") return "running";
  return "idle";
}

export interface CollabClaimGate {
  enabled: boolean;
  inFlight: boolean;
  activeLocal: number;
  globalLimit: number;
}

export function shouldClaimCollabTask(gate: CollabClaimGate): boolean {
  if (!gate.enabled || gate.inFlight) return false;
  return gate.activeLocal < Math.max(1, gate.globalLimit);
}

export function collabLeaseOwner(instanceId: string): string {
  return `${COLLAB_LEASE_OWNER_PREFIX}:${instanceId}`;
}

/** 心跳失败：租约/fencing 过期的错误码意味着本端必须放弃该尝试。 */
export function isCollabAttemptRevoked(code: string): boolean {
  return code === "STALE_ATTEMPT" || code === "NOT_FOUND" || code === "REQUIREMENT_CANCELLED";
}
