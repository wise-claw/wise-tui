import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Drawer, message, Space, Tabs, Typography } from "antd";
import { listen } from "@tauri-apps/api/event";
import { safeUnlisten } from "../../utils/safeTauriUnlisten";
import type { ClaudeSession } from "../../types";
import {
  assemblePartsFromStdoutLines,
  assemblePartsFromStdoutLinesForDisplay,
  MAX_STDOUT_LINES_FOR_STREAM_PARTS,
} from "../../utils/backgroundInvocationStdoutParts";
import { LinkifiedPre } from "./LinkifiedPre";
import { MessagePartsDisplay } from "./MessageParts";
import {
  WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
  WORKFLOW_UI_EVENT_INVOCATION_STREAM,
  WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER,
  type BackgroundInvocationBundleChangedDetail,
  type OpenBackgroundInvocationDrawerDetail,
  type WorkflowInvocationStreamDetail,
} from "../../constants/workflowUiEvents";
import {
  clearInvocationSnapshotBundle,
  mergeInvocationSnapshotIntoBundle,
  readInvocationSnapshotBundle,
  type BackgroundInvocationSnapshot,
} from "../../services/backgroundInvocationSnapshot";
import { isWebViewDevToolsLikelyOpen } from "../../utils/adaptivePoll";
import { StreamJsonStdoutHelpButton } from "../StreamJsonStdoutHelpButton";

interface Props {
  session: ClaudeSession;
  /** 为 false 时不挂载监听与 bundle 恢复（非焦点 idle 窗格省内存） */
  enabled?: boolean;
}

interface ActiveInvocation {
  invocationKey: string;
  taskId?: string;
  templateId?: string;
  attempt?: number;
  phase: "running" | "done";
  success?: boolean;
  lineCount: number;
  errCount: number;
  previewLine?: string;
  /** 传入子进程的完整 prompt（与 `executeClaudeCode` 一致） */
  dispatchPrompt?: string;
  stdoutLines: string[];
  stderrLines: string[];
}

const MAX_LINES_CAPTURE = 3500;
/** 快照中单次 prompt 上限，避免 settings 写入失败 */
const MAX_SNAPSHOT_PROMPT_CHARS = 100_000;

type InvocationMap = Record<string, ActiveInvocation>;

/** 让出主线程，避免切换会话后立刻解析/灌入巨量快照时与首帧竞争导致长时间无响应 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      window.setTimeout(() => resolve(), 0);
    }
  });
}

function buildSnapshotFromBuffers(
  invocationKey: string,
  meta: { taskId?: string; templateId?: string; attempt?: number; dispatchPrompt?: string },
  buffers: { stdout: string[]; stderr: string[] },
  phase: ActiveInvocation["phase"],
  success?: boolean,
): BackgroundInvocationSnapshot {
  const stdoutLines = buffers.stdout.slice(-MAX_LINES_CAPTURE);
  const stderrLines = buffers.stderr.slice(-Math.floor(MAX_LINES_CAPTURE / 2));
  const tail = stdoutLines.length > 0 ? stdoutLines[stdoutLines.length - 1] : "";
  const previewLine = tail.length > 140 ? `${tail.slice(0, 140)}…` : tail || undefined;
  const rawPrompt = meta.dispatchPrompt?.trim();
  const dispatchPrompt =
    rawPrompt && rawPrompt.length > MAX_SNAPSHOT_PROMPT_CHARS
      ? `${rawPrompt.slice(0, MAX_SNAPSHOT_PROMPT_CHARS)}\n…[truncated for storage]`
      : rawPrompt;
  return {
    invocationKey,
    taskId: meta.taskId,
    templateId: meta.templateId,
    attempt: meta.attempt,
    phase,
    success: phase === "done" ? success : undefined,
    lineCount: buffers.stdout.length,
    errCount: buffers.stderr.length,
    previewLine,
    dispatchPrompt,
    stdoutLines,
    stderrLines,
    updatedAt: Date.now(),
  };
}

export function BackgroundInvocationDock({ session, enabled = true }: Props) {
  if (!enabled) return null;
  return <BackgroundInvocationDockInner session={session} />;
}

function BackgroundInvocationDockInner({ session }: { session: ClaudeSession }) {
  const [invocationMap, setInvocationMap] = useState<InvocationMap>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  /** 直连批量等外部写入 bundle 后，在不切换标签的情况下触发与 `session.id` 变化相同的重载 */
  const [bundleReloadNonce, setBundleReloadNonce] = useState(0);

  const buffersRef = useRef<Record<string, { stdout: string[]; stderr: string[] }>>({});
  const metaByKeyRef = useRef<Record<string, { taskId?: string; templateId?: string; attempt?: number; dispatchPrompt?: string }>>({});
  const unsubsByKeyRef = useRef<Record<string, Array<() => void>>>({});
  const flushTimerRef = useRef<number | null>(null);
  const sessionRef = useRef(session);
  const invocationMapRef = useRef<InvocationMap>({});
  const preferredOpenKeyRef = useRef<string | null>(null);
  const drawerOpenRef = useRef(drawerOpen);
  const selectedKeyRef = useRef(selectedKey);
  /** 运行中 flush 不复制大数组到 state；抽屉打开时 bump 以从 buffersRef 重读 */
  const [bufferDisplayNonce, setBufferDisplayNonce] = useState(0);

  sessionRef.current = session;
  invocationMapRef.current = invocationMap;
  drawerOpenRef.current = drawerOpen;
  selectedKeyRef.current = selectedKey;

  const readLineBuffersForKey = useCallback(
    (invocationKey: string, inv: ActiveInvocation | null | undefined): { stdoutLines: string[]; stderrLines: string[] } => {
      if (!inv) return { stdoutLines: [], stderrLines: [] };
      if (inv.phase === "running") {
        const buf = buffersRef.current[invocationKey];
        if (buf) {
          return {
            stdoutLines: buf.stdout.slice(-MAX_LINES_CAPTURE),
            stderrLines: buf.stderr.slice(-Math.floor(MAX_LINES_CAPTURE / 2)),
          };
        }
      }
      return { stdoutLines: inv.stdoutLines, stderrLines: inv.stderrLines };
    },
    [],
  );

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const detachListenersForKey = useCallback(
    (invocationKey: string) => {
      const list = unsubsByKeyRef.current[invocationKey];
      if (list) {
        for (const u of list) {
          safeUnlisten(u);
        }
        delete unsubsByKeyRef.current[invocationKey];
      }
    },
    [],
  );

  const detachAllListeners = useCallback(() => {
    for (const key of Object.keys(unsubsByKeyRef.current)) {
      detachListenersForKey(key);
    }
    stopFlushTimer();
  }, [detachListenersForKey, stopFlushTimer]);

  const persistKey = useCallback(
    (invocationKey: string, phase: ActiveInvocation["phase"], success?: boolean, sidOverride?: string, rpOverride?: string) => {
      const sid = sidOverride ?? sessionRef.current.id;
      const rp = rpOverride ?? sessionRef.current.repositoryPath;
      const buffers = buffersRef.current[invocationKey];
      if (!buffers) return;
      const meta = metaByKeyRef.current[invocationKey] ?? {};
      const snap = buildSnapshotFromBuffers(invocationKey, meta, buffers, phase, success);
      void mergeInvocationSnapshotIntoBundle(sid, rp, snap);
    },
    [],
  );

  const flushKeyFromBuffers = useCallback(
    (invocationKey: string, phase: ActiveInvocation["phase"], success?: boolean) => {
      const buffers = buffersRef.current[invocationKey];
      if (!buffers) return;
      const meta = metaByKeyRef.current[invocationKey] ?? {};
      const stdoutLines = buffers.stdout.slice(-MAX_LINES_CAPTURE);
      const stderrLines = buffers.stderr.slice(-Math.floor(MAX_LINES_CAPTURE / 2));
      const previewLineRaw = stdoutLines.length > 0 ? stdoutLines[stdoutLines.length - 1] : undefined;
      const previewLine =
        previewLineRaw && previewLineRaw.length > 140 ? `${previewLineRaw.slice(0, 140)}…` : previewLineRaw;
      const includeLinesInState = phase !== "running";
      setInvocationMap((prev) => {
        const cur = prev[invocationKey];
        if (!cur) return prev;
        const nextEntry: ActiveInvocation = {
          ...cur,
          phase,
          success: success ?? cur.success,
          lineCount: buffers.stdout.length,
          errCount: buffers.stderr.length,
          previewLine,
          dispatchPrompt: meta.dispatchPrompt ?? cur.dispatchPrompt,
          stdoutLines: includeLinesInState ? stdoutLines : cur.stdoutLines,
          stderrLines: includeLinesInState ? stderrLines : cur.stderrLines,
        };
        if (
          cur.phase === nextEntry.phase &&
          cur.success === nextEntry.success &&
          cur.lineCount === nextEntry.lineCount &&
          cur.errCount === nextEntry.errCount &&
          cur.previewLine === nextEntry.previewLine &&
          cur.dispatchPrompt === nextEntry.dispatchPrompt &&
          (!includeLinesInState ||
            (cur.stdoutLines === nextEntry.stdoutLines && cur.stderrLines === nextEntry.stderrLines))
        ) {
          return prev;
        }
        return {
          ...prev,
          [invocationKey]: nextEntry,
        };
      });
      if (phase === "running" && drawerOpenRef.current && selectedKeyRef.current === invocationKey) {
        setBufferDisplayNonce((n) => n + 1);
      }
      persistKey(invocationKey, phase, success);
    },
    [persistKey],
  );

  const ensureFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) return;
    const intervalMs = document.hidden
      ? 2000
      : isWebViewDevToolsLikelyOpen()
        ? 1500
        : drawerOpenRef.current
          ? 800
          : 2500;
    flushTimerRef.current = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const keys = Object.keys(unsubsByKeyRef.current);
      let hasRunning = false;
      for (const invocationKey of keys) {
        const inv = invocationMapRef.current[invocationKey];
        if (inv?.phase === "running") {
          hasRunning = true;
          flushKeyFromBuffers(invocationKey, "running");
        }
      }
      if (!hasRunning) {
        stopFlushTimer();
      }
    }, intervalMs);
  }, [flushKeyFromBuffers, stopFlushTimer]);

  const attachTauriBuffersForKey = useCallback(
    (invocationKey: string) => {
      void (async () => {
        try {
          const uo = await listen<string>(`claude-output:invocation:${invocationKey}`, (ev) => {
            const buf = buffersRef.current[invocationKey];
            if (!buf) return;
            const line = String(ev.payload ?? "");
            buf.stdout.push(line);
            if (buf.stdout.length > MAX_LINES_CAPTURE * 2) {
              buf.stdout.splice(0, buf.stdout.length - MAX_LINES_CAPTURE);
            }
          });
          const ue = await listen<string>(`claude-error:invocation:${invocationKey}`, (ev) => {
            const buf = buffersRef.current[invocationKey];
            if (!buf) return;
            const line = String(ev.payload ?? "");
            buf.stderr.push(line);
            if (buf.stderr.length > MAX_LINES_CAPTURE) {
              buf.stderr.splice(0, buf.stderr.length - Math.floor(MAX_LINES_CAPTURE / 2));
            }
          });
          unsubsByKeyRef.current[invocationKey] = [...(unsubsByKeyRef.current[invocationKey] ?? []), uo, ue];
        } catch {
          /* 浏览器 / 无 Tauri */
        }
        ensureFlushTimer();
      })();
    },
    [ensureFlushTimer],
  );

  const handleInvocationStarted = useCallback(
    (detail: WorkflowInvocationStreamDetail) => {
      const invocationKey = detail.invocationKey;
      buffersRef.current[invocationKey] = { stdout: [], stderr: [] };
      metaByKeyRef.current[invocationKey] = {
        taskId: detail.taskId,
        templateId: detail.templateId,
        attempt: detail.attempt,
        dispatchPrompt: detail.dispatchPrompt?.trim() || metaByKeyRef.current[invocationKey]?.dispatchPrompt,
      };
      setRestored(false);
      setInvocationMap((prev) => ({
        ...prev,
        [invocationKey]: {
          invocationKey,
          taskId: detail.taskId,
          templateId: detail.templateId,
          attempt: detail.attempt,
          phase: "running",
          lineCount: 0,
          errCount: 0,
          dispatchPrompt: detail.dispatchPrompt?.trim(),
          stdoutLines: [],
          stderrLines: [],
        },
      }));
      setSelectedKey(invocationKey);
      attachTauriBuffersForKey(invocationKey);
      persistKey(invocationKey, "running");
    },
    [attachTauriBuffersForKey, persistKey],
  );

  useEffect(() => {
    const sid = session.id;
    const rp = session.repositoryPath;
    detachAllListeners();
    buffersRef.current = {};
    metaByKeyRef.current = {};
    let cancelled = false;
    void (async () => {
      const bundle = await readInvocationSnapshotBundle(sid, rp);
      if (cancelled) return;
      await yieldToBrowser();
      if (cancelled) return;
      const next: InvocationMap = {};
      const snaps = Object.values(bundle.items).filter((s): s is BackgroundInvocationSnapshot =>
        Boolean(s?.invocationKey),
      );
      for (let i = 0; i < snaps.length; i++) {
        const snap = snaps[i]!;
        metaByKeyRef.current[snap.invocationKey] = {
          taskId: snap.taskId,
          templateId: snap.templateId,
          attempt: snap.attempt,
          dispatchPrompt: snap.dispatchPrompt,
        };
        if (snap.phase === "running") {
          buffersRef.current[snap.invocationKey] = {
            stdout: [...snap.stdoutLines],
            stderr: [...snap.stderrLines],
          };
        }
        next[snap.invocationKey] = {
          invocationKey: snap.invocationKey,
          taskId: snap.taskId,
          templateId: snap.templateId,
          attempt: snap.attempt,
          phase: snap.phase,
          success: snap.success,
          lineCount: snap.lineCount,
          errCount: snap.errCount,
          previewLine: snap.previewLine,
          dispatchPrompt: snap.dispatchPrompt,
          stdoutLines: snap.phase === "running" ? [] : [...snap.stdoutLines],
          stderrLines: snap.phase === "running" ? [] : [...snap.stderrLines],
        };
        if (snap.phase === "running") {
          attachTauriBuffersForKey(snap.invocationKey);
        }
        if (snaps.length > 3 && i < snaps.length - 1 && (i + 1) % 2 === 0) {
          await new Promise<void>((r) => window.setTimeout(r, 0));
          if (cancelled) return;
        }
      }
      const keys = Object.keys(next);
      startTransition(() => {
        invocationMapRef.current = next;
        setRestored(keys.length > 0);
        setInvocationMap(next);
        setDrawerOpen(false);
        if (keys.length > 0) {
          const preferred = preferredOpenKeyRef.current;
          preferredOpenKeyRef.current = null;
          const pick =
            preferred && next[preferred]
              ? preferred
              : [...keys].sort((a, b) => (next[b]?.lineCount ?? 0) - (next[a]?.lineCount ?? 0))[0] ?? keys[0];
          setSelectedKey(pick ?? null);
        } else {
          setSelectedKey(null);
        }
      });
    })();

    return () => {
      cancelled = true;
      for (const key of Object.keys(invocationMapRef.current)) {
        const inv = invocationMapRef.current[key];
        const buf = buffersRef.current[key];
        const hasBuffer = buf && (buf.stdout.length > 0 || buf.stderr.length > 0 || inv?.phase === "running");
        if (inv && hasBuffer) {
          persistKey(key, inv.phase, inv.success, sid, rp);
        }
      }
      detachAllListeners();
    };
    // 仅随会话切换或 bundle 外部更新重载；勿依赖 attachTauriBuffersForKey 引用以免并行 invocation 监听被反复卸载。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 有意仅在这些 deps 时全量重载
  }, [session.id, session.repositoryPath, bundleReloadNonce]);

  useEffect(() => {
    function onBundleExternallyUpdated(ev: Event) {
      const detail = (ev as CustomEvent<BackgroundInvocationBundleChangedDetail>).detail;
      if (!detail?.sessionId?.trim() || !detail.repositoryPath?.trim()) return;
      const wantSid = detail.sessionId.trim();
      const wantRp = detail.repositoryPath.trim();
      if (wantRp !== session.repositoryPath.trim()) return;
      const curSid = session.id.trim();
      const curClaude = session.claudeSessionId?.trim() ?? "";
      if (wantSid !== curSid && wantSid !== curClaude) return;
      setBundleReloadNonce((n) => n + 1);
    }
    window.addEventListener(WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED, onBundleExternallyUpdated as EventListener);
    return () => {
      window.removeEventListener(
        WORKFLOW_UI_EVENT_BACKGROUND_INVOCATION_BUNDLE_CHANGED,
        onBundleExternallyUpdated as EventListener,
      );
    };
  }, [session.id, session.repositoryPath, session.claudeSessionId]);

  useEffect(() => {
    function onStream(ev: Event) {
      const detail = (ev as CustomEvent<WorkflowInvocationStreamDetail>).detail;
      if (!detail) return;
      /** 直连批量 oneshot 仅用于侧栏 store；若在此挂 Tauri 逐行监听会与海量 stdout 争主线程 */
      if (detail.omcInvocationSource === "direct_batch") return;
      if (detail.sessionId !== session.id || detail.repositoryPath !== session.repositoryPath) return;

      if (detail.phase === "started") {
        handleInvocationStarted(detail);
        return;
      }
      if (detail.phase === "progress") {
        const invocationKey = detail.invocationKey;
        const nextPrompt = detail.dispatchPrompt?.trim();
        if (nextPrompt) {
          metaByKeyRef.current[invocationKey] = {
            ...metaByKeyRef.current[invocationKey],
            dispatchPrompt: nextPrompt,
          };
        }
        startTransition(() => {
          setInvocationMap((prev) => {
            const cur = prev[invocationKey];
            if (!cur) return prev;
            return {
              ...prev,
              [invocationKey]: {
                ...cur,
                lineCount: detail.lineCount ?? cur.lineCount,
                errCount: detail.errCount ?? cur.errCount,
                previewLine: detail.previewLine ?? cur.previewLine,
                attempt: detail.attempt ?? cur.attempt,
                dispatchPrompt: nextPrompt || cur.dispatchPrompt,
              },
            };
          });
        });
        return;
      }
      if (detail.phase === "complete") {
        const invocationKey = detail.invocationKey;
        const p = detail.dispatchPrompt?.trim();
        if (p) {
          metaByKeyRef.current[invocationKey] = {
            ...metaByKeyRef.current[invocationKey],
            dispatchPrompt: p,
          };
        }
        detachListenersForKey(invocationKey);
        if (Object.keys(unsubsByKeyRef.current).length === 0) {
          stopFlushTimer();
        }
        flushKeyFromBuffers(invocationKey, "done", detail.success);
        delete buffersRef.current[invocationKey];
        delete metaByKeyRef.current[invocationKey];
      }
    }

    window.addEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, onStream as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_INVOCATION_STREAM, onStream as EventListener);
    };
  }, [
    session.id,
    session.repositoryPath,
    handleInvocationStarted,
    detachListenersForKey,
    flushKeyFromBuffers,
    stopFlushTimer,
  ]);

  useEffect(() => {
    function onRequestOpenDrawer(ev: Event) {
      const detail = (ev as CustomEvent<OpenBackgroundInvocationDrawerDetail>).detail;
      if (!detail?.sessionId?.trim() || !detail.repositoryPath?.trim()) return;
      if (detail.repositoryPath.trim() !== session.repositoryPath.trim()) return;
      const want = detail.sessionId.trim();
      if (want !== session.id.trim() && want !== session.claudeSessionId?.trim()) return;

      const pref = detail.preferredInvocationKey?.trim();
      preferredOpenKeyRef.current = pref && pref.length > 0 ? pref : null;

      if (preferredOpenKeyRef.current && invocationMapRef.current[preferredOpenKeyRef.current]) {
        const pk = preferredOpenKeyRef.current;
        preferredOpenKeyRef.current = null;
        setSelectedKey(pk);
        setDrawerOpen(true);
        const inv = invocationMapRef.current[pk];
        if (inv) {
          flushKeyFromBuffers(pk, inv.phase, inv.success);
        }
        return;
      }

      const openFromMap = () => {
        const keys = Object.keys(invocationMapRef.current);
        if (keys.length === 0) {
          return;
        }
        const pick =
          preferredOpenKeyRef.current && invocationMapRef.current[preferredOpenKeyRef.current]
            ? preferredOpenKeyRef.current
            : keys[0];
        preferredOpenKeyRef.current = null;
        if (!pick) return;
        const inv = invocationMapRef.current[pick];
        if (inv) {
          flushKeyFromBuffers(pick, inv.phase, inv.success);
        }
        setSelectedKey(pick);
        setDrawerOpen(true);
      };

      if (Object.keys(invocationMapRef.current).length > 0) {
        openFromMap();
        return;
      }

      void (async () => {
        const bundle = await readInvocationSnapshotBundle(session.id, session.repositoryPath);
        await yieldToBrowser();
        const snaps = Object.values(bundle.items).filter((s): s is BackgroundInvocationSnapshot =>
          Boolean(s?.invocationKey),
        );
        if (snaps.length === 0) {
          return;
        }
        const next: InvocationMap = {};
        for (let i = 0; i < snaps.length; i++) {
          const snap = snaps[i]!;
          metaByKeyRef.current[snap.invocationKey] = {
            taskId: snap.taskId,
            templateId: snap.templateId,
            attempt: snap.attempt,
            dispatchPrompt: snap.dispatchPrompt,
          };
          if (snap.phase === "running") {
            buffersRef.current[snap.invocationKey] = {
              stdout: [...snap.stdoutLines],
              stderr: [...snap.stderrLines],
            };
          }
          next[snap.invocationKey] = {
            invocationKey: snap.invocationKey,
            taskId: snap.taskId,
            templateId: snap.templateId,
            attempt: snap.attempt,
            phase: snap.phase,
            success: snap.success,
            lineCount: snap.lineCount,
            errCount: snap.errCount,
            previewLine: snap.previewLine,
            dispatchPrompt: snap.dispatchPrompt,
            stdoutLines: snap.phase === "running" ? [] : [...snap.stdoutLines],
            stderrLines: snap.phase === "running" ? [] : [...snap.stderrLines],
          };
          if (snap.phase === "running") {
            attachTauriBuffersForKey(snap.invocationKey);
          }
          if (snaps.length > 3 && i < snaps.length - 1 && (i + 1) % 2 === 0) {
            await new Promise<void>((r) => window.setTimeout(r, 0));
          }
        }
        startTransition(() => {
          invocationMapRef.current = next;
          setInvocationMap(next);
          setRestored(true);
          const wantKey =
            preferredOpenKeyRef.current && next[preferredOpenKeyRef.current]
              ? preferredOpenKeyRef.current
              : Object.keys(next)[0];
          preferredOpenKeyRef.current = null;
          if (wantKey) {
            const inv = next[wantKey];
            if (inv) {
              flushKeyFromBuffers(wantKey, inv.phase, inv.success);
            }
            setSelectedKey(wantKey);
          }
          setDrawerOpen(true);
        });
      })();
    }
    window.addEventListener(WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER, onRequestOpenDrawer as EventListener);
    return () => {
      window.removeEventListener(WORKFLOW_UI_EVENT_OPEN_BACKGROUND_INVOCATION_DRAWER, onRequestOpenDrawer as EventListener);
    };
  }, [session.id, session.repositoryPath, session.claudeSessionId, flushKeyFromBuffers, attachTauriBuffersForKey]);

  function handleDismiss() {
    void clearInvocationSnapshotBundle(session.id, session.repositoryPath);
    detachAllListeners();
    buffersRef.current = {};
    metaByKeyRef.current = {};
    setDrawerOpen(false);
    setInvocationMap({});
    setSelectedKey(null);
    setRestored(false);
  }

  async function copyToClipboard(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      void message.success(`${label} 已复制到剪贴板`);
    } catch {
      void message.error("复制失败，请手动选择文本复制");
    }
  }

  const active = useMemo(() => {
    if (!selectedKey) return null;
    return invocationMap[selectedKey] ?? null;
  }, [invocationMap, selectedKey]);

  const sortedInvocationKeys = useMemo(() => {
    return Object.keys(invocationMap).sort((a, b) => {
      const ia = invocationMap[a];
      const ib = invocationMap[b];
      const da = ia?.phase === "running" ? 1 : 0;
      const db = ib?.phase === "running" ? 1 : 0;
      if (da !== db) return db - da;
      return (ib?.lineCount ?? 0) - (ia?.lineCount ?? 0);
    });
  }, [invocationMap]);

  useEffect(() => {
    if (selectedKey && invocationMap[selectedKey]) return;
    const first = sortedInvocationKeys[0];
    if (first && first !== selectedKey) {
      setSelectedKey(first);
      return;
    }
    if (!first && selectedKey) {
      setSelectedKey(null);
    }
  }, [invocationMap, selectedKey, sortedInvocationKeys]);

  const activeLineBuffers = useMemo(() => {
    if (!selectedKey || !active) return { stdoutLines: [] as string[], stderrLines: [] as string[] };
    return readLineBuffersForKey(selectedKey, active);
  }, [active, selectedKey, bufferDisplayNonce, readLineBuffersForKey]);

  const stdoutParts = useMemo(
    () =>
      assemblePartsFromStdoutLinesForDisplay(
        activeLineBuffers.stdoutLines.slice(-MAX_STDOUT_LINES_FOR_STREAM_PARTS),
      ),
    [activeLineBuffers.stdoutLines],
  );
  const stderrParts = useMemo(
    () =>
      assemblePartsFromStdoutLines(
        activeLineBuffers.stderrLines.slice(-Math.floor(MAX_STDOUT_LINES_FOR_STREAM_PARTS / 2)),
      ),
    [activeLineBuffers.stderrLines],
  );

  const drawerTabItems = useMemo(() => {
    if (!active) return [];
    const stdoutLabel = `标准输出 (${activeLineBuffers.stdoutLines.length})`;
    const stderrLabel = `标准错误 (${activeLineBuffers.stderrLines.length})`;
    const stdoutChild: ReactNode =
      stdoutParts.length > 0 ? (
        <div className="app-background-invocation-drawer__parsed" tabIndex={0}>
          <MessagePartsDisplay parts={stdoutParts} streaming={false} />
        </div>
      ) : (
        <pre className="app-background-invocation-drawer__pre" tabIndex={0}>
          {activeLineBuffers.stdoutLines.join("\n") || "（暂无）"}
        </pre>
      );
    const stderrChild: ReactNode =
      stderrParts.length > 0 ? (
        <div
          className="app-background-invocation-drawer__parsed app-background-invocation-drawer__parsed--stderr"
          tabIndex={0}
        >
          <MessagePartsDisplay parts={stderrParts} streaming={false} />
        </div>
      ) : (
        <div className="app-background-invocation-drawer__pre-wrap">
          <LinkifiedPre
            text={activeLineBuffers.stderrLines.join("\n") || "（暂无）"}
            className="app-background-invocation-drawer__pre-linkified"
          />
        </div>
      );
    return [
      { key: "stdout", label: stdoutLabel, children: stdoutChild },
      { key: "stderr", label: stderrLabel, children: stderrChild },
    ];
  }, [active, activeLineBuffers.stderrLines, activeLineBuffers.stdoutLines, stdoutParts, stderrParts]);

  if (sortedInvocationKeys.length === 0 && !drawerOpen) return null;

  const titleBits = [active?.taskId, active?.templateId].filter(Boolean).join(" · ");
  const drawerTitle = `后台执行详情${titleBits ? ` · ${titleBits}` : ""}`;
  return (
    <>
      <Drawer
        title={drawerTitle}
        placement="right"
        size={Math.min(720, typeof window !== "undefined" ? window.innerWidth - 24 : 720)}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
        }}
        extra={
          <Button type="link" size="small" danger onClick={() => handleDismiss()}>
            清除记录
          </Button>
        }
      >
        <>
            {sortedInvocationKeys.length > 1 ? (
              <div className="app-background-invocation-drawer__routes" style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                  多路并行执行，请选择一路查看输出与派发正文：
                </Typography.Text>
                <Space wrap size="small">
                  {sortedInvocationKeys.map((key, index) => {
                    const inv = invocationMap[key];
                    const label =
                      (inv?.taskId?.trim() ? `任务 ${inv.taskId}` : `执行 ${index + 1}`) +
                      (inv?.phase === "running" ? " · 进行中" : inv?.success === false ? " · 失败" : inv?.phase === "done" ? " · 已完成" : "");
                    return (
                      <Button
                        key={key}
                        size="small"
                        type={selectedKey === key ? "primary" : "default"}
                        onClick={() => setSelectedKey(key)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </Space>
              </div>
            ) : null}
            <div className="app-background-invocation-drawer__hint">
              {restored
                ? "以下为切换会话前自动保存的截断输出；与主会话列表无关。"
                : "与主会话分离的子进程输出；大量行已截断保留最近约 " + String(MAX_LINES_CAPTURE) + " 行。"}
            </div>
            {active ? (
              <>
                <div className="app-background-invocation-drawer__toolbar">
                  <Space wrap size="small">
                    {active.dispatchPrompt?.trim() ? (
                      <Button
                        type="default"
                        size="small"
                        onClick={() => {
                          void copyToClipboard("派发正文", active.dispatchPrompt ?? "");
                        }}
                      >
                        复制派发正文
                      </Button>
                    ) : null}
                    <Button
                      type="default"
                      size="small"
                      onClick={() => {
                        void copyToClipboard("标准输出", activeLineBuffers.stdoutLines.join("\n"));
                      }}
                    >
                      复制标准输出
                    </Button>
                    <Button
                      type="default"
                      size="small"
                      onClick={() => {
                        void copyToClipboard("标准错误", activeLineBuffers.stderrLines.join("\n"));
                      }}
                    >
                      复制标准错误
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => {
                        const block = [
                          "--- 标准输出 ---",
                          activeLineBuffers.stdoutLines.join("\n"),
                          "",
                          "--- 标准错误 ---",
                          activeLineBuffers.stderrLines.join("\n"),
                        ].join("\n");
                        void copyToClipboard("标准输出+标准错误", block);
                      }}
                    >
                      复制全部
                    </Button>
                  </Space>
                </div>
                <div className="app-background-invocation-drawer__dispatch">
                  <Typography.Text type="secondary" className="app-background-invocation-drawer__dispatch-label">
                    发送给 Claude Code 的内容（与 execute_claude_code 的 prompt 一致）
                  </Typography.Text>
                  {active.dispatchPrompt?.trim() ? (
                    <div className="app-background-invocation-drawer__dispatch-body">
                      <LinkifiedPre text={active.dispatchPrompt} className="app-background-invocation-drawer__dispatch-pre" />
                    </div>
                  ) : (
                    <Typography.Text type="secondary" className="app-background-invocation-drawer__dispatch-empty">
                      暂无保存的派发正文（旧快照或未带 streamUi 的调用不包含该字段）。
                    </Typography.Text>
                  )}
                </div>
                <details className="app-background-invocation-drawer__meta">
                  <summary className="app-background-invocation-drawer__meta-summary">调试信息</summary>
                  <pre className="app-background-invocation-drawer__meta-pre">
                    {[`invocationKey: ${active.invocationKey}`, `attempt: ${active.attempt ?? "-"}`, `sessionId: ${session.id}`].join(
                      "\n",
                    )}
                  </pre>
                </details>
                <Tabs
                  className="app-background-invocation-drawer__output-tabs"
                  items={drawerTabItems}
                  tabBarExtraContent={{
                    right: <StreamJsonStdoutHelpButton ariaLabel="标准输出与标准错误解析说明" />,
                  }}
                />
              </>
            ) : (
              <Typography.Text type="secondary">请选择一路执行查看输出。</Typography.Text>
            )}
        </>
      </Drawer>
    </>
  );
}
