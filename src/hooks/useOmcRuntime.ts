import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "antd";
import type { ClaudeSession, EmployeeItem, Repository } from "../types";
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  WORKFLOW_UI_EVENT_INVOCATION_STREAM,
  WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED,
  WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER,
  type BackgroundInvocationBundleChangedDetail,
  type OpenBackgroundInvocationDrawerDetail,
  type WorkflowInvocationStreamDetail,
  type WorkflowOmcBatchRuntimeDetail,
} from "../constants/workflowUiEvents";
import { cancelClaudeInvocation } from "../services/claude";
import {
  readInvocationSnapshotBundle,
  reconcileDirectBatchInvocationRowsWithBundles,
} from "../services/backgroundInvocationSnapshot";
import {
  cancelOmcDirectBatchInvocationsPersistSchedule,
  clearOmcDirectBatchInvocationsPersisted,
  digestOmcDirectBatchInvocationsList,
  flushPersistOmcDirectBatchInvocations,
  flushPersistOmcDirectBatchInvocationsLocal,
  loadOmcDirectBatchInvocationsFromLocalStorageSync,
  loadOmcDirectBatchInvocationsPersisted,
  schedulePersistOmcDirectBatchInvocations,
  sortOmcDirectBatchInvocationsForStore,
  trimOmcDirectBatchInvocationMap,
  trimOmcWorkflowInvocationRuntimeMap,
  trimRepositoryMemberInvocationMap,
} from "../services/omcDirectBatchInvocationsPersistence";
import {
  resetOmcDirectBatchInvocationsStore,
  setOmcDirectBatchInvocationsStore,
} from "../stores/omcDirectBatchInvocationsStore";
import {
  digestRepositoryMemberInvocations,
  resetRepositoryMemberInvocationsStore,
  setRepositoryMemberInvocationsStore,
} from "../stores/repositoryMemberInvocationsStore";
import { isOmcDirectBatchInvocationRunning } from "../utils/omcDirectBatchInvocationDisplay";
import {
  extractRepositoryBoundEmployeeName,
  omcWorkerRepositoryBoundNameMatchers,
} from "../utils/omcMonitorEmployeeSession";
import { pickSessionForRepositorySidebarSelect } from "../utils/claudeSessionSelection";
import { loadSessionOwnerHints } from "../utils/sessionOwnerHints";
import {
  isRepositoryMainSessionTab,
  normalizeRepositoryPathKey as normalizeRepositoryPathForMatch,
  resolveBoundMainSessionId,
  resolveMainOwnerAgentNameForRepositoryPath,
} from "../utils/repositoryMainSessionBinding";

interface UseOmcRuntimeOptions {
  employees: EmployeeItem[];
  jumpToSessionWithRepository: (sessionId: string) => void;
  repositoryMainSessionBindings: Record<string, string>;
  repositories: Repository[];
  sessions: ClaudeSession[];
}

function mergeHydratedInvocation(
  prev: WorkflowInvocationStreamDetail | undefined,
  next: WorkflowInvocationStreamDetail,
): WorkflowInvocationStreamDetail {
  function withSubprocessSid(
    chosen: WorkflowInvocationStreamDetail,
    other?: WorkflowInvocationStreamDetail,
  ): WorkflowInvocationStreamDetail {
    const sid = chosen.subprocessSessionId?.trim() || other?.subprocessSessionId?.trim();
    return sid && !chosen.subprocessSessionId?.trim() ? { ...chosen, subprocessSessionId: sid } : chosen;
  }
  if (!prev) return withSubprocessSid(next);
  if (prev.phase === "complete") return withSubprocessSid(prev, next);
  if (next.phase === "complete") return withSubprocessSid(next, prev);
  const lcN = next.lineCount ?? 0;
  const lcP = prev.lineCount ?? 0;
  if (lcN > lcP) return withSubprocessSid(next, prev);
  if (lcN < lcP) return withSubprocessSid(prev, next);
  const erN = next.errCount ?? 0;
  const erP = prev.errCount ?? 0;
  if (erN > erP) return withSubprocessSid(next, prev);
  if (erN < erP) return withSubprocessSid(prev, next);
  const chosen = (next.previewLine?.length ?? 0) > (prev.previewLine?.length ?? 0) ? next : prev;
  const other = chosen === next ? prev : next;
  return withSubprocessSid(chosen, other);
}

const OMC_TEMPLATE_SET = new Set(["autopilot", "ultraqa", "verify", "team", "trellis"]);
const DIRECT_BATCH_UI_PROGRESS_DEBOUNCE_MS = 720;

function isOmcLikeInvocation(detail: WorkflowInvocationStreamDetail): boolean {
  const templateId = detail.templateId?.trim() ?? "";
  if (OMC_TEMPLATE_SET.has(templateId)) return true;
  const taskId = detail.taskId?.trim() ?? "";
  return taskId.startsWith("task-");
}

export function useOmcRuntime({
  employees,
  jumpToSessionWithRepository,
  repositoryMainSessionBindings,
  repositories,
  sessions,
}: UseOmcRuntimeOptions) {
  const [omcBatchRuntime, setOmcBatchRuntime] = useState<WorkflowOmcBatchRuntimeDetail | null>(null);
  const omcBatchRuntimeRef = useRef<WorkflowOmcBatchRuntimeDetail | null>(null);
  omcBatchRuntimeRef.current = omcBatchRuntime;

  const omcDirectBatchInvocationRef = useRef<Map<string, WorkflowInvocationStreamDetail>>(new Map());
  const repositoryMemberInvocationRef = useRef<Map<string, WorkflowInvocationStreamDetail>>(new Map());
  const omcDirectBatchEndPendingRef = useRef(false);
  const omcDirectBatchProgressUiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const omcInvocationRuntimeRef = useRef<Map<string, WorkflowInvocationStreamDetail>>(new Map());
  const omcInvocationRuntimeApplyRafRef = useRef<number | null>(null);
  const omcUiAnchorRef = useRef<{ sessionId: string; repositoryPath: string } | null>(null);

  const employeesRef = useRef(employees);
  const jumpToSessionWithRepositoryRef = useRef(jumpToSessionWithRepository);
  const repositoryMainSessionBindingsRef = useRef(repositoryMainSessionBindings);
  const repositoriesRef = useRef(repositories);
  const sessionsRef = useRef(sessions);
  employeesRef.current = employees;
  jumpToSessionWithRepositoryRef.current = jumpToSessionWithRepository;
  repositoryMainSessionBindingsRef.current = repositoryMainSessionBindings;
  repositoriesRef.current = repositories;
  sessionsRef.current = sessions;

  const flushDirectBatchInvocationUiNowRef = useRef<() => void>(() => {});
  const flushInvocationRuntimeApplyRef = useRef<() => void>(() => {});

  const applyHydratedRows = useCallback((rows: WorkflowInvocationStreamDetail[]) => {
    if (rows.length === 0) return;
    for (const inv of rows) {
      const k = inv.invocationKey;
      const prev = omcDirectBatchInvocationRef.current.get(k);
      const merged = mergeHydratedInvocation(prev, inv);
      omcDirectBatchInvocationRef.current.set(k, merged);
    }
    trimOmcDirectBatchInvocationMap(omcDirectBatchInvocationRef.current);
    const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
    setOmcDirectBatchInvocationsStore(list, digestOmcDirectBatchInvocationsList(list));
  }, []);

  useEffect(() => {
    applyHydratedRows(loadOmcDirectBatchInvocationsFromLocalStorageSync());

    let cancelled = false;
    void (async () => {
      const rows = await loadOmcDirectBatchInvocationsPersisted();
      if (cancelled) return;
      const reconciled = await reconcileDirectBatchInvocationRowsWithBundles(rows);
      if (cancelled) return;
      applyHydratedRows(reconciled);
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      void flushPersistOmcDirectBatchInvocations(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyHydratedRows]);

  useEffect(() => {
    function persistDirectBatchRefSnapshot(localOnly = false) {
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      if (localOnly) {
        flushPersistOmcDirectBatchInvocationsLocal(list);
        return;
      }
      void flushPersistOmcDirectBatchInvocations(list);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        persistDirectBatchRefSnapshot(true);
      }
    }
    function onPageHide() {
      persistDirectBatchRefSnapshot(true);
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    const directBatchRefHasRunning = (): boolean => {
      for (const inv of omcDirectBatchInvocationRef.current.values()) {
        if (isOmcDirectBatchInvocationRunning(inv)) return true;
      }
      return false;
    };

    const applyInvocationRuntime = () => {
      trimRepositoryMemberInvocationMap(repositoryMemberInvocationRef.current);
      trimOmcWorkflowInvocationRuntimeMap(omcInvocationRuntimeRef.current);
      const repositoryMemberInvocations = Array.from(repositoryMemberInvocationRef.current.values()).sort((a, b) => {
        const ta = typeof a.attempt === "number" ? a.attempt : 0;
        const tb = typeof b.attempt === "number" ? b.attempt : 0;
        return tb - ta;
      });
      setRepositoryMemberInvocationsStore(
        repositoryMemberInvocations,
        digestRepositoryMemberInvocations(repositoryMemberInvocations),
      );
      const list = Array.from(omcInvocationRuntimeRef.current.values());
      if (list.length === 0) {
        if (directBatchRefHasRunning()) {
          return;
        }
        setOmcBatchRuntime(null);
        omcDirectBatchEndPendingRef.current = false;
        return;
      }
      list.sort((a, b) => {
        const ta = typeof a.attempt === "number" ? a.attempt : 0;
        const tb = typeof b.attempt === "number" ? b.attempt : 0;
        return tb - ta;
      });
      const latest = list[0];
      if (!latest) {
        if (directBatchRefHasRunning()) {
          return;
        }
        setOmcBatchRuntime(null);
        omcDirectBatchEndPendingRef.current = false;
        return;
      }
      const anchRaw = typeof latest.sessionId === "string" ? latest.sessionId.trim() : "";
      const anchRp = typeof latest.repositoryPath === "string" ? latest.repositoryPath.trim() : "";
      const anchHit = anchRaw
        ? sessionsRef.current.find((s) => s.id === anchRaw || s.claudeSessionId?.trim() === anchRaw)
        : undefined;
      const anchSid = anchHit?.id ?? anchRaw;
      if (anchSid && anchRp) {
        omcUiAnchorRef.current = { sessionId: anchSid, repositoryPath: anchRp };
      }
      setOmcBatchRuntime({
        active: true,
        sessionId: latest.sessionId,
        runningCount: list.length,
        updatedAt: Date.now(),
      });
    };

    const applyDirectBatchInvocationUi = (persistMode: "debounced" | "immediate") => {
      trimOmcDirectBatchInvocationMap(omcDirectBatchInvocationRef.current);
      const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
      const digest = digestOmcDirectBatchInvocationsList(list);
      setOmcDirectBatchInvocationsStore(list, digest);
      if (persistMode === "immediate") {
        void flushPersistOmcDirectBatchInvocations(list);
      } else {
        schedulePersistOmcDirectBatchInvocations(list);
      }
    };

    const flushDirectBatchInvocationUiNow = () => {
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
        omcDirectBatchProgressUiTimeoutRef.current = null;
      }
      applyDirectBatchInvocationUi("immediate");
    };

    const scheduleDirectBatchInvocationProgressDebounced = () => {
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
      }
      omcDirectBatchProgressUiTimeoutRef.current = setTimeout(() => {
        omcDirectBatchProgressUiTimeoutRef.current = null;
        applyDirectBatchInvocationUi("debounced");
      }, DIRECT_BATCH_UI_PROGRESS_DEBOUNCE_MS);
    };

    const flushInvocationRuntimeApply = () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) {
        cancelAnimationFrame(omcInvocationRuntimeApplyRafRef.current);
        omcInvocationRuntimeApplyRafRef.current = null;
      }
      applyInvocationRuntime();
    };

    const scheduleInvocationRuntimeApply = () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) return;
      omcInvocationRuntimeApplyRafRef.current = requestAnimationFrame(() => {
        omcInvocationRuntimeApplyRafRef.current = null;
        applyInvocationRuntime();
      });
    };

    flushDirectBatchInvocationUiNowRef.current = flushDirectBatchInvocationUiNow;
    flushInvocationRuntimeApplyRef.current = flushInvocationRuntimeApply;

    function handleOmcBatchRuntimeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkflowOmcBatchRuntimeDetail>).detail;
      if (!detail || typeof detail !== "object") return;

      if (detail.active && detail.resetInvocationUi !== false) {
        omcDirectBatchEndPendingRef.current = false;
        omcDirectBatchInvocationRef.current.clear();
        if (omcDirectBatchProgressUiTimeoutRef.current != null) {
          clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
          omcDirectBatchProgressUiTimeoutRef.current = null;
        }
        resetOmcDirectBatchInvocationsStore();
        void clearOmcDirectBatchInvocationsPersisted();
      }

      requestAnimationFrame(() => {
        if (!detail.active) {
          const workflowInv = omcInvocationRuntimeRef.current.size;
          const snap = Array.from(omcDirectBatchInvocationRef.current.values());
          const directRunning = snap.filter((inv) => isOmcDirectBatchInvocationRunning(inv)).length;
          omcDirectBatchEndPendingRef.current = directRunning > 0;
          if (workflowInv === 0 && directRunning === 0) {
            omcDirectBatchEndPendingRef.current = false;
            setOmcBatchRuntime(null);
          } else if (workflowInv > 0) {
            flushInvocationRuntimeApply();
          } else {
            flushDirectBatchInvocationUiNow();
            const first = snap.find((inv) => isOmcDirectBatchInvocationRunning(inv)) ?? snap[0];
            const prev = omcBatchRuntimeRef.current;
            const sidRaw =
              (typeof first?.sessionId === "string" ? first.sessionId.trim() : "") ||
              (typeof detail.sessionId === "string" ? detail.sessionId.trim() : "") ||
              (typeof prev?.sessionId === "string" ? prev.sessionId.trim() : "");
            setOmcBatchRuntime({
              active: true,
              sessionId: sidRaw || prev?.sessionId,
              runningCount: directRunning,
              updatedAt: Date.now(),
              directBatchTaskTotal: prev?.directBatchTaskTotal,
              directBatchTaskFinished: prev?.directBatchTaskFinished,
              directBatchClaudeCodeSessions: prev?.directBatchClaudeCodeSessions,
            });
          }
          return;
        }

        const batchSidRaw = typeof detail.sessionId === "string" ? detail.sessionId.trim() : "";
        const batchHit = batchSidRaw
          ? sessionsRef.current.find((s) => s.id === batchSidRaw || s.claudeSessionId?.trim() === batchSidRaw)
          : undefined;
        const batchSid = batchHit?.id ?? batchSidRaw;
        const repoFromAnchor = batchHit?.repositoryPath?.trim() ?? "";
        if (batchSid && repoFromAnchor) {
          omcUiAnchorRef.current = { sessionId: batchSid, repositoryPath: repoFromAnchor };
        }
        setOmcBatchRuntime({
          active: true,
          sessionId: detail.sessionId,
          runningCount: detail.runningCount,
          updatedAt: detail.updatedAt ?? Date.now(),
          resetInvocationUi: detail.resetInvocationUi,
          directBatchTaskTotal: detail.directBatchTaskTotal,
          directBatchTaskFinished: detail.directBatchTaskFinished,
          directBatchClaudeCodeSessions: detail.directBatchClaudeCodeSessions,
        });
      });
    }

    function handleInvocationRuntimeChanged(event: Event) {
      const detail = (event as CustomEvent<WorkflowInvocationStreamDetail>).detail;
      if (!detail || typeof detail !== "object") return;
      if (detail.omcInvocationSource === "direct_batch") {
        const lean: WorkflowInvocationStreamDetail = { ...detail };
        if (detail.phase === "complete") {
          const prev = omcDirectBatchInvocationRef.current.get(detail.invocationKey);
          const sid = detail.subprocessSessionId?.trim() || prev?.subprocessSessionId?.trim();
          const merged: WorkflowInvocationStreamDetail = {
            ...lean,
            ...(sid ? { subprocessSessionId: sid } : {}),
          };
          omcDirectBatchInvocationRef.current.set(detail.invocationKey, merged);
          flushDirectBatchInvocationUiNow();
          let runningRemaining = 0;
          for (const inv of omcDirectBatchInvocationRef.current.values()) {
            if (isOmcDirectBatchInvocationRunning(inv)) runningRemaining += 1;
          }
          if (
            omcDirectBatchEndPendingRef.current &&
            runningRemaining === 0 &&
            omcInvocationRuntimeRef.current.size === 0
          ) {
            omcDirectBatchEndPendingRef.current = false;
            setOmcBatchRuntime(null);
          }
        } else {
          const prev = omcDirectBatchInvocationRef.current.get(detail.invocationKey);
          const sid = detail.subprocessSessionId?.trim() || prev?.subprocessSessionId?.trim() || undefined;
          const merged: WorkflowInvocationStreamDetail = {
            ...(prev ?? {}),
            ...lean,
            ...(sid ? { subprocessSessionId: sid } : {}),
          };
          omcDirectBatchInvocationRef.current.set(detail.invocationKey, merged);
          if (detail.phase === "started") {
            flushDirectBatchInvocationUiNow();
          } else {
            scheduleDirectBatchInvocationProgressDebounced();
          }
        }
        return;
      }

      if (detail.templateId === "trellis" && detail.ownerKind === "repository") {
        if (detail.phase === "complete") {
          repositoryMemberInvocationRef.current.delete(detail.invocationKey);
        } else {
          repositoryMemberInvocationRef.current.set(detail.invocationKey, detail);
        }
      }
      if (!isOmcLikeInvocation(detail)) return;
      const invSidRaw = typeof detail.sessionId === "string" ? detail.sessionId.trim() : "";
      const invRp = typeof detail.repositoryPath === "string" ? detail.repositoryPath.trim() : "";
      const invHit = invSidRaw
        ? sessionsRef.current.find((s) => s.id === invSidRaw || s.claudeSessionId?.trim() === invSidRaw)
        : undefined;
      const invSid = invHit?.id ?? invSidRaw;
      if (invSid && invRp) {
        omcUiAnchorRef.current = { sessionId: invSid, repositoryPath: invRp };
      }
      if (detail.phase === "complete") {
        omcInvocationRuntimeRef.current.delete(detail.invocationKey);
        flushInvocationRuntimeApply();
      } else if (detail.phase === "progress") {
        omcInvocationRuntimeRef.current.set(detail.invocationKey, detail);
        scheduleInvocationRuntimeApply();
      } else {
        omcInvocationRuntimeRef.current.set(detail.invocationKey, detail);
        flushInvocationRuntimeApply();
      }
    }

    function handleInvocationBundleExternallyUpdated(event: Event) {
      const detail = (event as CustomEvent<BackgroundInvocationBundleChangedDetail>).detail;
      if (!detail || typeof detail.sessionId !== "string" || typeof detail.repositoryPath !== "string") return;
      const sidRaw = detail.sessionId.trim();
      const rpRaw = detail.repositoryPath.trim();
      if (!sidRaw || !rpRaw) return;
      void (async () => {
        const bundle = await readInvocationSnapshotBundle(sidRaw, rpRaw);
        const pathKey = normalizeRepositoryPathForMatch(rpRaw);
        const canonSid =
          sessionsRef.current.find((s) => s.id === sidRaw || s.claudeSessionId?.trim() === sidRaw)?.id ?? sidRaw;
        let touched = false;
        for (const [ik, inv] of [...omcDirectBatchInvocationRef.current.entries()]) {
          if (inv.omcInvocationSource !== "direct_batch") continue;
          if (inv.phase === "complete") continue;
          if (normalizeRepositoryPathForMatch(inv.repositoryPath ?? "") !== pathKey) continue;
          const invSid = inv.sessionId.trim();
          if (invSid !== canonSid && invSid !== sidRaw) continue;
          const snap = bundle.items[ik];
          const hasPersisted =
            snap?.phase === "done" ||
            (Array.isArray(snap?.stdoutLines) && snap.stdoutLines.length > 0) ||
            (Array.isArray(snap?.stderrLines) && snap.stderrLines.length > 0);
          if (!hasPersisted) continue;
          omcDirectBatchInvocationRef.current.set(ik, {
            ...inv,
            phase: "complete",
            success: typeof snap?.success === "boolean" ? snap.success : inv.success,
            lineCount: snap?.lineCount ?? inv.lineCount,
            errCount: snap?.errCount ?? inv.errCount,
            ...(snap?.previewLine ? { previewLine: snap.previewLine } : {}),
          });
          touched = true;
        }
        if (touched) {
          flushDirectBatchInvocationUiNow();
        }
      })();
    }

    window.addEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, handleOmcBatchRuntimeChanged as EventListener);
    window.addEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, handleInvocationRuntimeChanged as EventListener);
    window.addEventListener(
      WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
      handleInvocationBundleExternallyUpdated as EventListener,
    );
    return () => {
      if (omcInvocationRuntimeApplyRafRef.current != null) {
        cancelAnimationFrame(omcInvocationRuntimeApplyRafRef.current);
        omcInvocationRuntimeApplyRafRef.current = null;
      }
      if (omcDirectBatchProgressUiTimeoutRef.current != null) {
        clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
        omcDirectBatchProgressUiTimeoutRef.current = null;
      }
      cancelOmcDirectBatchInvocationsPersistSchedule();
      repositoryMemberInvocationRef.current.clear();
      resetRepositoryMemberInvocationsStore();
      window.removeEventListener(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, handleOmcBatchRuntimeChanged as EventListener);
      window.removeEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, handleInvocationRuntimeChanged as EventListener);
      window.removeEventListener(
        WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
        handleInvocationBundleExternallyUpdated as EventListener,
      );
    };
  }, []);

  const handleCancelOmcDirectBatchInvocation = useCallback((invocationKey: string) => {
    const k = invocationKey.trim();
    if (!k) return;
    void cancelClaudeInvocation(k)
      .then((didKill) => {
        if (didKill) return;
        if (omcDirectBatchProgressUiTimeoutRef.current != null) {
          clearTimeout(omcDirectBatchProgressUiTimeoutRef.current);
          omcDirectBatchProgressUiTimeoutRef.current = null;
        }
        const removedFromList = omcDirectBatchInvocationRef.current.delete(k);
        if (removedFromList) {
          const list = sortOmcDirectBatchInvocationsForStore([...omcDirectBatchInvocationRef.current.values()]);
          const digest = digestOmcDirectBatchInvocationsList(list);
          setOmcDirectBatchInvocationsStore(list, digest);
          void flushPersistOmcDirectBatchInvocations(list);
        }
        const directRunning = [...omcDirectBatchInvocationRef.current.values()].filter(isOmcDirectBatchInvocationRunning)
          .length;
        const workflowInv = omcInvocationRuntimeRef.current.size;
        const batchActive = Boolean(omcBatchRuntimeRef.current?.active);
        const omcNameMatchers = omcWorkerRepositoryBoundNameMatchers(employeesRef.current);
        const omcWorkerTabBusy = sessionsRef.current.some((s) => {
          if (s.status !== "running" && s.status !== "connecting") return false;
          const bound = extractRepositoryBoundEmployeeName(s.repositoryName);
          return bound !== null && omcNameMatchers.has(bound);
        });
        if (directRunning === 0 && workflowInv === 0) {
          if (batchActive) {
            setOmcBatchRuntime(null);
          }
          omcDirectBatchEndPendingRef.current = false;
          if (!omcWorkerTabBusy) {
            void message.warning(
              removedFromList
                ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；当前无其它 OMC 活动，OMC 员工已显示为空闲。"
                : "未在宿主侧找到该子进程（可能已结束或列表为历史记录）；本地索引中无该条，无法从会话记录移除。当前无其它 OMC 活动，侧栏 OMC 状态已重置为空闲。",
            );
          } else {
            void message.warning(
              removedFromList
                ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；直连批量与流式 invocation 已无进行中，但 OMC 员工工作标签会话仍在运行，侧栏可能仍显示进行中。"
                : "未在宿主侧找到该子进程；直连批量与流式 invocation 已无进行中，但 OMC 员工工作标签会话仍在运行。",
            );
          }
        } else {
          void message.warning(
            removedFromList
              ? "未在宿主侧找到该子进程，已从 OMC 员工会话记录中移除本条；其它 OMC 活动仍在进行中。"
              : "未在宿主侧找到该子进程（可能已结束或列表为历史记录）；本地索引中无该条，无法从会话记录移除；其它 OMC 活动仍在进行中。",
          );
        }
      })
      .catch((err) => {
        console.error("cancelClaudeInvocation:", err);
        message.error("结束该 Claude Code 子进程失败");
      });
  }, []);

  const handleOpenOmcBatchInvocationDetail = useCallback((input: {
    sessionId: string;
    repositoryPath: string;
    invocationKey: string;
  }) => {
    const anchorSid = input.sessionId.trim();
    const rp = input.repositoryPath.trim();
    const ik = input.invocationKey.trim();
    if (!rp || !ik) return;

    const sessionsNow = sessionsRef.current;
    const mainOwnerPick = resolveMainOwnerAgentNameForRepositoryPath(repositoriesRef.current, rp);
    let targetId: string | null = resolveBoundMainSessionId(
      rp,
      repositoryMainSessionBindingsRef.current,
      sessionsNow,
      mainOwnerPick,
    );
    if (!targetId) {
      const picked = pickSessionForRepositorySidebarSelect(sessionsNow, rp, loadSessionOwnerHints(), {
        mainOwnerAgentName: mainOwnerPick,
      });
      targetId = picked?.id ?? null;
    }
    const pathKey = normalizeRepositoryPathForMatch(rp);
    if (!targetId && anchorSid) {
      const anchorHit = sessionsNow.find((item) => item.id === anchorSid || item.claudeSessionId?.trim() === anchorSid);
      if (anchorHit && isRepositoryMainSessionTab(anchorHit, pathKey, mainOwnerPick)) {
        targetId = anchorHit.id;
      }
    }
    if (!targetId) {
      void message.warning("未找到该仓库的 Repo 执行会话，请先在侧栏打开仓库后再查看后台输出。");
      return;
    }

    jumpToSessionWithRepositoryRef.current(targetId);
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent<OpenBackgroundInvocationDrawerDetail>(WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER, {
          detail: {
            sessionId: targetId,
            repositoryPath: rp,
            preferredInvocationKey: ik,
          },
        }),
      );
    });
  }, []);

  const getOmcMonitorStopSnapshot = useCallback(() => {
    const workflowInvocationKeys = Array.from(omcInvocationRuntimeRef.current.keys());
    const directBatchInvocationKeys = Array.from(omcDirectBatchInvocationRef.current.entries())
      .filter(([, inv]) => isOmcDirectBatchInvocationRunning(inv))
      .map(([k]) => k);
    return {
      invocationKeys: [...new Set([...workflowInvocationKeys, ...directBatchInvocationKeys])],
      batchSessionId: omcBatchRuntimeRef.current?.sessionId?.trim() || undefined,
    };
  }, []);

  const markOmcBatchRuntimeAborted = useCallback((sessionId?: string) => {
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_UI_EVENT_OMC_BATCH_RUNTIME_CHANGED, {
        detail: {
          active: false,
          sessionId,
          runningCount: 0,
          updatedAt: Date.now(),
          abortedByUser: true,
        },
      }),
    );
  }, []);

  const moveOmcRuntimeSessionId = useCallback((fromTabId: string, toClaudeSessionId: string) => {
    const anchor = omcUiAnchorRef.current;
    if (anchor?.sessionId === fromTabId) {
      omcUiAnchorRef.current = { ...anchor, sessionId: toClaudeSessionId };
    }
    const invMap = omcInvocationRuntimeRef.current;
    for (const [key, detail] of [...invMap.entries()]) {
      if (detail.sessionId === fromTabId) {
        invMap.set(key, { ...detail, sessionId: toClaudeSessionId });
      }
    }
  }, []);

  return {
    getOmcMonitorStopSnapshot,
    handleCancelOmcDirectBatchInvocation,
    handleOpenOmcBatchInvocationDetail,
    markOmcBatchRuntimeAborted,
    moveOmcRuntimeSessionId,
    omcBatchRuntime,
  };
}
