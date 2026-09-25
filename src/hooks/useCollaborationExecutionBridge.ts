import { useEffect, useRef, type MutableRefObject } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { materializeClaudeSpawnMcpConfig } from "../services/claude";
import {
  bindCollabSession,
  claimCollabTask,
  COLLAB_CLAIM_INTERVAL_MS,
  COLLAB_HEARTBEAT_INTERVAL_MS,
  collabLeaseOwner,
  collabSpawnNeedsMcpMaterialize,
  collabSpawnToCliExtras,
  confirmCollabLaunch,
  decideCollabSessionOutcome,
  finishCollabAttempt,
  getCollabAutomationSettings,
  heartbeatCollabAttempt,
  hydrateCollabAutomationSettings,
  isCollabAttemptRevoked,
  listActiveCollabAttempts,
  markCollabStopPending,
  normalizeCollabError,
  observeCollabSession,
  onCollabChanged,
  reconcileCollabAttempt,
  shouldClaimCollabTask,
  type CollabObservedSessionStatus,
} from "../services/collaboration";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { hydrateAutomationPause, isGlobalAutomationPaused } from "../services/automationPauseStore";
import { isSessionExecutionEngine, type SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { getClaudeSessionsSnapshot } from "../stores/claudeSessionsLiveStore";
import {
  registerCollabSessionBinding,
  releaseCollabSessionBinding,
} from "../stores/collabSessionSpawnStore";
import { registerCollabDiscussionHandler } from "../stores/collabUiStore";
import type { CollabClaimedTask, CollabFinishOutcome } from "../types/collaboration";

const WATCH_INTERVAL_MS = 2_000;
const LAUNCH_GRACE_MS = 120_000;
const STOP_CONFIRM_MS = 20_000;
const MCP_MATERIALIZE_TIMEOUT_MS = 8_000;

interface TrackedAttempt {
  attemptId: string;
  fencingToken: number;
  sessionId: string;
  requirementId: string;
  startedAt: number;
  sawRunning: boolean;
  lastHeartbeatAt: number;
  stopRequestedAt: number | null;
  stopPendingMarked: boolean;
  finishing: boolean;
}

interface Params {
  createSessionRef: MutableRefObject<
    (
      repositoryPath: string,
      repositoryName: string,
      opts?: {
        skipActivate?: boolean;
        connectionKind?: "oneshot" | "streaming";
        initialModel?: string;
        initialExecutionEngine?: SessionExecutionEngine;
      },
    ) => Promise<string>
  >;
  executeSessionRef: MutableRefObject<(sessionId: string, prompt: string) => boolean>;
  cancelSessionRef: MutableRefObject<(sessionId: string) => void>;
  closeSessionRef: MutableRefObject<(sessionId: string) => void | Promise<void>>;
}

function sessionStatus(sessionId: string): CollabObservedSessionStatus | null {
  const s = getClaudeSessionsSnapshot().find((x) => x.id === sessionId);
  return s ? s.status : null;
}

function newInstanceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function materializeMcp(claimed: CollabClaimedTask, repositoryPath: string): Promise<string | null> {
  if (!collabSpawnNeedsMcpMaterialize(claimed.spawn)) return null;
  const path = await Promise.race([
    materializeClaudeSpawnMcpConfig({
      repositoryPath,
      serverKeys: claimed.spawn.mcpServerKeys,
      extraConfigPaths: claimed.spawn.mcpExtraConfigPaths,
    }),
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), MCP_MATERIALIZE_TIMEOUT_MS)),
  ]);
  if (!path && claimed.spawn.strictMcpConfig) {
    throw new Error("MCP 配置生成失败，智能体要求严格 MCP 隔离");
  }
  return path;
}

/**
 * 协作执行桥：从 Rust 调度领取任务 → 在目标仓库建会话并注入智能体 spawn 配置 → 心跳续约 →
 * 会话结束/停止/失联时回报。仅主窗口运行；启动时按 dispatchKey 核对遗留尝试。
 */
export function useCollaborationExecutionBridge({
  createSessionRef,
  executeSessionRef,
  cancelSessionRef,
  closeSessionRef,
}: Params): void {
  const trackedRef = useRef(new Map<string, TrackedAttempt>());
  const claimInFlightRef = useRef(false);

  useEffect(() => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    let disposed = false;
    const leaseOwner = collabLeaseOwner(newInstanceId());
    const tracked = trackedRef.current;
    void hydrateCollabAutomationSettings();
    void hydrateAutomationPause();

    const finish = async (t: TrackedAttempt, outcome: CollabFinishOutcome, message?: string) => {
      if (t.finishing) return;
      t.finishing = true;
      try {
        await finishCollabAttempt({
          attemptId: t.attemptId,
          fencingToken: t.fencingToken,
          outcome,
          message: message ?? null,
          durationMs: Date.now() - t.startedAt,
        });
      } catch (e) {
        const err = normalizeCollabError(e);
        if (!isCollabAttemptRevoked(err.code)) {
          t.finishing = false;
          return;
        }
      }
      tracked.delete(t.attemptId);
      releaseCollabSessionBinding(t.sessionId);
    };

    const launch = async (claimed: CollabClaimedTask) => {
      const { attempt } = claimed;
      const check = await confirmCollabLaunch(attempt.id, attempt.fencingToken);
      if (!check.proceed) return;
      const failBeforeSession = async (message: string) => {
        await finishCollabAttempt({
          attemptId: attempt.id,
          fencingToken: attempt.fencingToken,
          outcome: "error",
          message,
        }).catch(() => undefined);
      };
      const repoPath = claimed.repository?.path?.trim();
      if (!repoPath) {
        await failBeforeSession("任务没有可执行的仓库路径");
        return;
      }
      let extras;
      try {
        const mcpPath = await materializeMcp(claimed, repoPath);
        extras = collabSpawnToCliExtras(claimed.spawn, mcpPath);
      } catch (e) {
        await failBeforeSession(e instanceof Error ? e.message : String(e));
        return;
      }
      const engine = claimed.spawn.engineId;
      let sessionId: string;
      try {
        sessionId = await createSessionRef.current(repoPath, claimed.sessionName, {
          skipActivate: true,
          connectionKind: "streaming",
          initialModel: claimed.spawn.model?.trim() || undefined,
          initialExecutionEngine: isSessionExecutionEngine(engine) ? engine : undefined,
        });
      } catch (e) {
        await failBeforeSession(`创建会话失败：${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      registerCollabSessionBinding(sessionId, {
        kind: "attempt",
        attemptId: attempt.id,
        fencingToken: attempt.fencingToken,
        requirementId: claimed.requirementId,
        taskId: claimed.task.id,
        extras,
      });
      const t: TrackedAttempt = {
        attemptId: attempt.id,
        fencingToken: attempt.fencingToken,
        sessionId,
        requirementId: claimed.requirementId,
        startedAt: Date.now(),
        sawRunning: false,
        lastHeartbeatAt: Date.now(),
        stopRequestedAt: null,
        stopPendingMarked: false,
        finishing: false,
      };
      try {
        await bindCollabSession(attempt.id, attempt.fencingToken, sessionId);
      } catch (e) {
        releaseCollabSessionBinding(sessionId);
        void closeSessionRef.current(sessionId);
        const err = normalizeCollabError(e);
        if (!isCollabAttemptRevoked(err.code)) await failBeforeSession(`绑定会话失败：${err.message}`);
        return;
      }
      tracked.set(attempt.id, t);
      const ok = executeSessionRef.current(sessionId, claimed.prompt);
      if (!ok) await finish(t, "error", "会话繁忙，未能发送任务");
    };

    const claimTick = async () => {
      if (disposed) return;
      const settings = getCollabAutomationSettings();
      const gate = {
        enabled: !settings.paused && !isGlobalAutomationPaused(),
        inFlight: claimInFlightRef.current,
        activeLocal: tracked.size,
        globalLimit: settings.globalLimit,
      };
      if (!shouldClaimCollabTask(gate)) return;
      claimInFlightRef.current = true;
      try {
        for (let i = 0; i < 4 && !disposed; i += 1) {
          const outcome = await claimCollabTask({ leaseOwner, globalLimit: settings.globalLimit, knownMcpServerIds: null });
          if (!outcome.claimed) break;
          try {
            await launch(outcome.claimed);
          } catch (e) {
            console.warn("[collab] launch failed", e);
          }
          if (tracked.size >= settings.globalLimit) break;
        }
      } catch (e) {
        console.warn("[collab] claim failed", e);
      } finally {
        claimInFlightRef.current = false;
      }
    };

    const watchTick = async () => {
      if (disposed) return;
      const now = Date.now();
      for (const t of [...tracked.values()]) {
        if (t.finishing) continue;
        const status = sessionStatus(t.sessionId);
        if (status === "running" || status === "connecting") t.sawRunning = true;
        const outcome = decideCollabSessionOutcome(status, t.sawRunning);
        if (outcome) {
          await finish(t, t.stopRequestedAt != null && outcome !== "session_lost" ? "stopped" : outcome);
          continue;
        }
        if (!t.sawRunning && now - t.startedAt > LAUNCH_GRACE_MS) {
          await finish(t, "error", "会话未能启动");
          continue;
        }
        if (t.stopRequestedAt != null && !t.stopPendingMarked && now - t.stopRequestedAt > STOP_CONFIRM_MS) {
          t.stopPendingMarked = true;
          await markCollabStopPending(t.attemptId).catch(() => undefined);
        }
        if (now - t.lastHeartbeatAt >= COLLAB_HEARTBEAT_INTERVAL_MS) {
          t.lastHeartbeatAt = now;
          try {
            const ack = await heartbeatCollabAttempt(t.attemptId, t.fencingToken);
            if (ack.stopRequested && t.stopRequestedAt == null) {
              t.stopRequestedAt = now;
              cancelSessionRef.current(t.sessionId);
            }
          } catch (e) {
            const err = normalizeCollabError(e);
            if (isCollabAttemptRevoked(err.code)) {
              cancelSessionRef.current(t.sessionId);
              tracked.delete(t.attemptId);
              releaseCollabSessionBinding(t.sessionId);
            }
          }
        }
      }
    };

    const reconcileOnStart = async () => {
      let active;
      try {
        active = await listActiveCollabAttempts();
      } catch {
        return;
      }
      for (const att of active) {
        if (att.leaseOwner === leaseOwner || tracked.has(att.id)) continue;
        const observed = att.sessionId ? observeCollabSession(sessionStatus(att.sessionId)) : "missing";
        try {
          const row = await reconcileCollabAttempt({
            dispatchKey: att.dispatchKey,
            observed,
            sessionId: att.sessionId,
          });
          if (row && row.state !== "finished" && observed === "running" && att.sessionId) {
            tracked.set(row.id, {
              attemptId: row.id,
              fencingToken: row.fencingToken,
              sessionId: att.sessionId,
              requirementId: row.requirementId,
              startedAt: row.startedAt ?? Date.now(),
              sawRunning: true,
              lastHeartbeatAt: 0,
              stopRequestedAt: null,
              stopPendingMarked: false,
              finishing: false,
            });
          }
        } catch (e) {
          console.warn("[collab] reconcile failed", att.id, e);
        }
      }
    };

    let unlisten: UnlistenFn | null = null;
    let claimSoon: number | null = null;
    const scheduleClaim = () => {
      if (claimSoon != null) return;
      claimSoon = window.setTimeout(() => {
        claimSoon = null;
        void claimTick();
      }, 300);
    };

    registerCollabDiscussionHandler(async (req) => {
      const mcpPath = collabSpawnNeedsMcpMaterialize(req.spawn)
        ? await materializeClaudeSpawnMcpConfig({
            repositoryPath: req.repositoryPath,
            serverKeys: req.spawn.mcpServerKeys,
            extraConfigPaths: req.spawn.mcpExtraConfigPaths,
          }).catch(() => null)
        : null;
      const engine = req.spawn.engineId;
      const sessionId = await createSessionRef.current(req.repositoryPath, `讨论·${req.agentName}`, {
        skipActivate: false,
        connectionKind: "streaming",
        initialModel: req.spawn.model?.trim() || undefined,
        initialExecutionEngine: isSessionExecutionEngine(engine) ? engine : undefined,
      });
      registerCollabSessionBinding(sessionId, {
        kind: "discussion",
        agentId: req.agentId,
        originSessionId: req.originSessionId,
        extras: collabSpawnToCliExtras(req.spawn, mcpPath),
      });
      if (!executeSessionRef.current(sessionId, req.prompt)) {
        releaseCollabSessionBinding(sessionId);
        throw new Error("讨论会话繁忙，未能发送");
      }
      return sessionId;
    });

    const watchTimer = window.setInterval(() => void watchTick(), WATCH_INTERVAL_MS);
    const claimTimer = window.setInterval(() => void claimTick(), COLLAB_CLAIM_INTERVAL_MS);
    void reconcileOnStart().then(() => void claimTick());
    void onCollabChanged(() => scheduleClaim()).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      registerCollabDiscussionHandler(null);
      window.clearInterval(watchTimer);
      window.clearInterval(claimTimer);
      if (claimSoon != null) window.clearTimeout(claimSoon);
      unlisten?.();
    };
  }, [cancelSessionRef, closeSessionRef, createSessionRef, executeSessionRef]);
}
