import { useEffect, useSyncExternalStore } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  DEFAULT_COLLAB_COMPOSER_SELECTION,
  type CollabComposerSelection,
} from "../services/collaboration/composerIntent";
import { listCollabAgents, listCollabRequirementsForSession, onCollabChanged } from "../services/collaboration/ipc";
import type { CollabRecipientAgent } from "../services/collaboration/recipients";
import type { CollabAgentSummary, CollabSessionRequirement } from "../types/collaboration";

/** 每个会话输入框的接收者/模式/需求关联选择（仅本次运行，切换模式只影响下一次发送）。 */
const selections = new Map<string, CollabComposerSelection>();
const selectionListeners = new Set<() => void>();

const EMPTY_AGENTS: CollabRecipientAgent[] = [];
let agents: CollabRecipientAgent[] = EMPTY_AGENTS;
let agentsLoaded = false;
let agentsLoading: Promise<void> | null = null;
const agentListeners = new Set<() => void>();
let changedUnlisten: Promise<UnlistenFn> | null = null;

function emit(set: Set<() => void>): void {
  for (const l of set) l();
}

export function getCollabComposerSelection(sessionId: string): CollabComposerSelection {
  return selections.get(sessionId) ?? DEFAULT_COLLAB_COMPOSER_SELECTION;
}

export function setCollabComposerSelection(sessionId: string, patch: Partial<CollabComposerSelection>): void {
  const prev = getCollabComposerSelection(sessionId);
  const next = { ...prev, ...patch };
  if (!next.agentId) {
    selections.delete(sessionId);
  } else {
    selections.set(sessionId, next);
  }
  emit(selectionListeners);
}

/** 选择接收者：首次选择仓库智能体时采用其默认模式（未配置时为执行）。 */
export function selectCollabComposerAgent(sessionId: string, agentId: string | null): void {
  if (!agentId) {
    setCollabComposerSelection(sessionId, { agentId: null });
    return;
  }
  const prev = selections.get(sessionId);
  const agent = agents.find((a) => a.id === agentId) as (CollabRecipientAgent & { defaultMode?: string }) | undefined;
  const mode =
    prev?.agentId === agentId
      ? prev.mode
      : agent?.defaultMode === "discuss" || agent?.defaultMode === "plan"
        ? agent.defaultMode
        : "execute";
  setCollabComposerSelection(sessionId, { agentId, mode, target: prev?.target ?? { kind: "auto" } });
}

export function useCollabComposerSelection(sessionId: string): CollabComposerSelection {
  return useSyncExternalStore(
    (cb) => {
      selectionListeners.add(cb);
      return () => selectionListeners.delete(cb);
    },
    () => getCollabComposerSelection(sessionId),
    () => DEFAULT_COLLAB_COMPOSER_SELECTION,
  );
}

function toRecipient(a: CollabAgentSummary): CollabRecipientAgent & { defaultMode?: string } {
  return {
    id: a.id,
    name: typeof a.name === "string" ? a.name : a.id,
    status: a.status,
    bindings: Array.isArray(a.bindings) ? a.bindings : [],
    defaultMode: typeof a.defaultMode === "string" ? a.defaultMode : undefined,
  };
}

export function refreshCollabComposerAgents(): Promise<void> {
  if (agentsLoading) return agentsLoading;
  agentsLoading = listCollabAgents(false)
    .then((rows) => {
      agents = Array.isArray(rows) ? rows.map(toRecipient) : [];
      agentsLoaded = true;
      emit(agentListeners);
    })
    .catch(() => {
      agentsLoaded = true;
    })
    .finally(() => {
      agentsLoading = null;
    });
  return agentsLoading;
}

function ensureAgentsSubscribed(): void {
  if (!agentsLoaded && !agentsLoading) void refreshCollabComposerAgents();
  if (!changedUnlisten) {
    changedUnlisten = onCollabChanged((requirementId) => {
      if (requirementId == null) void refreshCollabComposerAgents();
    }).catch(() => () => undefined);
  }
}

/** 会话关联的协作需求缓存：发送前同步读取，用于判定“继续/新需求”。 */
const sessionRequirements = new Map<string, CollabSessionRequirement[]>();
const sessionReqListeners = new Set<() => void>();
const sessionReqInflight = new Map<string, Promise<void>>();
const EMPTY_SESSION_REQS: CollabSessionRequirement[] = [];

export function refreshCollabSessionRequirements(sessionId: string): Promise<void> {
  const existing = sessionReqInflight.get(sessionId);
  if (existing) return existing;
  const p = listCollabRequirementsForSession(sessionId)
    .then((rows) => {
      sessionRequirements.set(sessionId, Array.isArray(rows) ? rows : []);
      emit(sessionReqListeners);
    })
    .catch(() => undefined)
    .finally(() => sessionReqInflight.delete(sessionId));
  sessionReqInflight.set(sessionId, p);
  return p;
}

export function getCachedCollabSessionRequirements(sessionId: string): CollabSessionRequirement[] {
  return sessionRequirements.get(sessionId) ?? EMPTY_SESSION_REQS;
}

export function useCollabSessionRequirements(sessionId: string): CollabSessionRequirement[] {
  useEffect(() => {
    void refreshCollabSessionRequirements(sessionId);
    let timer: number | null = null;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onCollabChanged(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refreshCollabSessionRequirements(sessionId), 500);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [sessionId]);
  return useSyncExternalStore(
    (cb) => {
      sessionReqListeners.add(cb);
      return () => sessionReqListeners.delete(cb);
    },
    () => getCachedCollabSessionRequirements(sessionId),
    () => EMPTY_SESSION_REQS,
  );
}

export function getCollabComposerAgents(): CollabRecipientAgent[] {
  ensureAgentsSubscribed();
  return agents;
}

export function useCollabComposerAgents(): CollabRecipientAgent[] {
  return useSyncExternalStore(
    (cb) => {
      ensureAgentsSubscribed();
      agentListeners.add(cb);
      return () => agentListeners.delete(cb);
    },
    () => agents,
    () => EMPTY_AGENTS,
  );
}
