import { useEffect, useRef } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { ClaudeSession, EmployeeItem, Repository } from "../types";
import type { SessionExecutionEngine } from "../constants/sessionExecutionEngine";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
import { restoreComposerFocusAfterHudExit } from "../services/globalScreenshotHotkey";
import { wiseHudIsActive } from "../services/wiseHud";
import { getWiseHudModeActive, setWiseHudModeActive } from "../stores/wiseHudModeStore";
import { getAssistantsSnapshot } from "../stores/assistantsStore";
import type { AssistantEntry } from "../types/assistant";
import { resolveSessionExecutionEngine } from "../utils/sessionExecutionEngine";
import { safeUnlisten } from "../utils/safeTauriUnlisten";
import {
  collectHudSessionCompletions,
  sessionStatusMap,
} from "../utils/hudCompletionToast";
import {
  buildWiseHudSessionSnapshot,
  countHudRunningSessions,
  parseWiseHudActiveChanged,
  parseWiseHudSubmitPayload,
  parseWiseHudSelectRepositoryPayload,
  parseWiseHudSetEnginePayload,
  parseWiseHudSetModelPayload,
  parseWiseHudActivateAssistantPayload,
  parseWiseHudSetDetailsOpenPayload,
  resolveHudRunStatus,
  resolveHudSubmitSessionId,
  WISE_HUD_ACTIVE_EVENT,
  WISE_HUD_CANCEL_EVENT,
  WISE_HUD_NEW_SESSION_EVENT,
  WISE_HUD_REQUEST_STATE_EVENT,
  WISE_HUD_SELECT_REPOSITORY_EVENT,
  WISE_HUD_SESSION_COMPLETE_EVENT,
  WISE_HUD_ACTIVATE_ASSISTANT_EVENT,
  WISE_HUD_SET_DETAILS_OPEN_EVENT,
  WISE_HUD_SET_ENGINE_EVENT,
  WISE_HUD_SET_MODEL_EVENT,
  WISE_HUD_STATE_EVENT,
  WISE_HUD_SUBMIT_EVENT,
  type WiseHudSessionSnapshot,
} from "../utils/wiseHudSnapshot";

interface UseWiseHudBridgeInput {
  sessions: readonly ClaudeSession[];
  activeSessionId: string | null;
  repositories: readonly Repository[];
  employees: readonly EmployeeItem[];
  activeRepository?: Repository | null;
  executeSession: (sessionId: string, prompt: string) => boolean | Promise<boolean>;
  cancelSession: (sessionId: string) => void;
  selectRepository: (repositoryId: number) => void;
  createNewSession: (repository: Repository) => void | Promise<void>;
  setExecutionEngine: (sessionId: string, engine: SessionExecutionEngine) => void;
  setModel: (sessionId: string, model: string) => void;
  activateAssistant: (assistant: AssistantEntry) => void | Promise<void>;
  openBuiltinAssistant: (assistantId: string) => void;
}

function snapshotKey(snapshot: WiseHudSessionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function useWiseHudBridge({
  sessions,
  activeSessionId,
  repositories,
  employees,
  activeRepository = null,
  executeSession,
  cancelSession,
  selectRepository,
  createNewSession,
  setExecutionEngine,
  setModel,
  activateAssistant,
  openBuiltinAssistant,
}: UseWiseHudBridgeInput): void {
  const sessionsRef = useRef(sessions);
  const activeSessionIdRef = useRef(activeSessionId);
  const repositoriesRef = useRef(repositories);
  const employeesRef = useRef(employees);
  const activeRepositoryRef = useRef(activeRepository);
  const executeSessionRef = useRef(executeSession);
  const cancelSessionRef = useRef(cancelSession);
  const selectRepositoryRef = useRef(selectRepository);
  const createNewSessionRef = useRef(createNewSession);
  const setExecutionEngineRef = useRef(setExecutionEngine);
  const setModelRef = useRef(setModel);
  const activateAssistantRef = useRef(activateAssistant);
  const openBuiltinAssistantRef = useRef(openBuiltinAssistant);
  const lastKeyRef = useRef("");
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hadRunningInHudRef = useRef(false);
  const prevStatusByIdRef = useRef<Map<string, string>>(new Map());
  const detailsOpenRef = useRef(false);

  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;
  repositoriesRef.current = repositories;
  employeesRef.current = employees;
  activeRepositoryRef.current = activeRepository;
  executeSessionRef.current = executeSession;
  cancelSessionRef.current = cancelSession;
  selectRepositoryRef.current = selectRepository;
  createNewSessionRef.current = createNewSession;
  setExecutionEngineRef.current = setExecutionEngine;
  setModelRef.current = setModel;
  activateAssistantRef.current = activateAssistant;
  openBuiltinAssistantRef.current = openBuiltinAssistant;

  const buildSnapshot = (): WiseHudSessionSnapshot => {
    const session =
      sessionsRef.current.find((item) => item.id === activeSessionIdRef.current) ?? null;
    const engine = session
      ? resolveSessionExecutionEngine(
          session,
          repositoriesRef.current,
          employeesRef.current,
          activeRepositoryRef.current,
        )
      : "claude";
    const runningCount = countHudRunningSessions(sessionsRef.current);
    if (runningCount > 0) hadRunningInHudRef.current = true;
    return buildWiseHudSessionSnapshot(session, engine, {
      repositories: repositoriesRef.current,
      activeRepositoryId: activeRepositoryRef.current?.id ?? null,
      runningCount,
      runStatus: resolveHudRunStatus(runningCount, hadRunningInHudRef.current),
      includeMessages: detailsOpenRef.current,
    });
  };

  const publishNow = () => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    const snapshot = buildSnapshot();
    const key = snapshotKey(snapshot);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    void emit(WISE_HUD_STATE_EVENT, snapshot);
  };

  const publishSoon = () => {
    if (publishTimer.current) clearTimeout(publishTimer.current);
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      publishNow();
    }, 80);
  };

  useEffect(() => {
    const completions = collectHudSessionCompletions(prevStatusByIdRef.current, sessions);
    prevStatusByIdRef.current = sessionStatusMap(sessions);
    if (
      completions.length > 0 &&
      getWiseHudModeActive() &&
      isCurrentPrimaryMainWorkspaceWindowSync()
    ) {
      void emit(WISE_HUD_SESSION_COMPLETE_EVENT, { items: completions });
    }
  }, [sessions]);

  useEffect(() => {
    publishSoon();
    return () => {
      if (publishTimer.current) clearTimeout(publishTimer.current);
    };
  }, [sessions, activeSessionId, repositories, employees, activeRepository]);

  useEffect(() => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return;
    void wiseHudIsActive()
      .then((active) => setWiseHudModeActive(active))
      .catch(() => setWiseHudModeActive(false));
  }, []);

  useEffect(() => {
    if (!isCurrentPrimaryMainWorkspaceWindowSync()) return undefined;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    void (async () => {
      const u1 = await listen<unknown>(WISE_HUD_REQUEST_STATE_EVENT, () => {
        lastKeyRef.current = "";
        publishNow();
      });
      const u2 = await listen<unknown>(WISE_HUD_SUBMIT_EVENT, (event) => {
        const payload = parseWiseHudSubmitPayload(event.payload);
        if (!payload) return;
        const sessionId = resolveHudSubmitSessionId(
          payload.sessionId,
          activeSessionIdRef.current,
          sessionsRef.current.map((item) => item.id),
        );
        if (!sessionId) return;
        void executeSessionRef.current(sessionId, payload.text);
      });
      const u3 = await listen(WISE_HUD_CANCEL_EVENT, () => {
        const sessionId = activeSessionIdRef.current;
        if (!sessionId) return;
        cancelSessionRef.current(sessionId);
      });
      const u4 = await listen<unknown>(WISE_HUD_ACTIVE_EVENT, (event) => {
        const active = parseWiseHudActiveChanged(event.payload);
        if (active == null) return;
        setWiseHudModeActive(active);
        if (active) {
          hadRunningInHudRef.current =
            countHudRunningSessions(sessionsRef.current) > 0;
          lastKeyRef.current = "";
          publishNow();
        } else {
          detailsOpenRef.current = false;
          restoreComposerFocusAfterHudExit(activeSessionIdRef.current);
        }
      });
      const u5 = await listen<unknown>(WISE_HUD_SELECT_REPOSITORY_EVENT, (event) => {
        const payload = parseWiseHudSelectRepositoryPayload(event.payload);
        if (!payload) return;
        selectRepositoryRef.current(payload.repositoryId);
      });
      const u6 = await listen(WISE_HUD_NEW_SESSION_EVENT, () => {
        const repo = activeRepositoryRef.current;
        if (!repo) return;
        void createNewSessionRef.current(repo);
      });
      const resolveTargetSessionId = (hinted?: string) =>
        resolveHudSubmitSessionId(
          hinted,
          activeSessionIdRef.current,
          sessionsRef.current.map((item) => item.id),
        );
      const u7 = await listen<unknown>(WISE_HUD_SET_ENGINE_EVENT, (event) => {
        const payload = parseWiseHudSetEnginePayload(event.payload);
        if (!payload) return;
        const sessionId = resolveTargetSessionId(payload.sessionId);
        if (!sessionId) return;
        setExecutionEngineRef.current(sessionId, payload.engine);
      });
      const u8 = await listen<unknown>(WISE_HUD_SET_MODEL_EVENT, (event) => {
        const payload = parseWiseHudSetModelPayload(event.payload);
        if (!payload) return;
        const sessionId = resolveTargetSessionId(payload.sessionId);
        if (!sessionId) return;
        setModelRef.current(sessionId, payload.model);
      });
      const u9 = await listen<unknown>(WISE_HUD_SET_DETAILS_OPEN_EVENT, (event) => {
        const payload = parseWiseHudSetDetailsOpenPayload(event.payload);
        if (!payload) return;
        detailsOpenRef.current = payload.open;
        lastKeyRef.current = "";
        publishNow();
      });
      const u10 = await listen<unknown>(WISE_HUD_ACTIVATE_ASSISTANT_EVENT, (event) => {
        const payload = parseWiseHudActivateAssistantPayload(event.payload);
        if (!payload) return;
        const assistant = getAssistantsSnapshot().find((item) => item.id === payload.assistantId);
        if (assistant) {
          void activateAssistantRef.current(assistant);
          return;
        }
        openBuiltinAssistantRef.current(payload.assistantId);
      });
      if (cancelled) {
        safeUnlisten(u1);
        safeUnlisten(u2);
        safeUnlisten(u3);
        safeUnlisten(u4);
        safeUnlisten(u5);
        safeUnlisten(u6);
        safeUnlisten(u7);
        safeUnlisten(u8);
        safeUnlisten(u9);
        safeUnlisten(u10);
        return;
      }
      unsubs.push(
        () => safeUnlisten(u1),
        () => safeUnlisten(u2),
        () => safeUnlisten(u3),
        () => safeUnlisten(u4),
        () => safeUnlisten(u5),
        () => safeUnlisten(u6),
        () => safeUnlisten(u7),
        () => safeUnlisten(u8),
        () => safeUnlisten(u9),
        () => safeUnlisten(u10),
      );
    })();
    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
    };
  }, []);
}
