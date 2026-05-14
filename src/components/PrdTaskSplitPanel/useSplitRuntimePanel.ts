import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  SplitRetryPhase,
  SplitRuntimeLogItem,
  SplitRuntimeLogRole,
  SplitWizardStep,
} from "./types";

interface UseSplitRuntimePanelInput {
  requirementEditorShellRef: RefObject<HTMLDivElement | null>;
  splitPromptAdjustModalOpen: boolean;
  splitWizardStep: SplitWizardStep;
  onWarning: (content: string) => void;
}

export function useSplitRuntimePanel({
  requirementEditorShellRef,
  splitPromptAdjustModalOpen,
  splitWizardStep,
  onWarning,
}: UseSplitRuntimePanelInput) {
  const [splitRuntimeVisible, setSplitRuntimeVisible] = useState(false);
  const [splitRuntimeLogs, setSplitRuntimeLogs] = useState<SplitRuntimeLogItem[]>([]);
  const [retryingPhase, setRetryingPhase] = useState<SplitRetryPhase | null>(null);
  const splitRuntimeListRef = useRef<HTMLDivElement | null>(null);
  const splitRuntimeRef = useRef<HTMLDivElement | null>(null);
  const splitStageRetryHandlersRef = useRef<Partial<Record<SplitRetryPhase, (() => Promise<void>)>>>({});

  const resetSplitRuntimePanel = useCallback((title: string, options?: { inModal?: boolean }) => {
    const inModal = options?.inModal === true;
    setSplitRuntimeVisible(!inModal);
    setRetryingPhase(null);
    splitStageRetryHandlersRef.current = {};
    setSplitRuntimeLogs([
      {
        id: `${Date.now()}-boot`,
        role: "system",
        text: `${title}：开始准备输入并执行 Claude（当前流程仅解析结果与日志展示，暂不自动落库）。`,
        at: Date.now(),
      },
    ]);
  }, []);

  const appendSplitRuntimeLog = useCallback((
    role: SplitRuntimeLogRole,
    text: string,
    options?: { retryPhase?: SplitRetryPhase },
  ) => {
    const SPLIT_RUNTIME_LOG_LIMIT = 400;
    const content = text.trim();
    if (!content) return;
    setSplitRuntimeLogs((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${prev.length + 1}`,
          role,
          text: content,
          at: Date.now(),
          retryPhase: options?.retryPhase,
        },
      ];
      if (next.length <= SPLIT_RUNTIME_LOG_LIMIT) {
        return next;
      }
      return next.slice(next.length - SPLIT_RUNTIME_LOG_LIMIT);
    });
  }, []);

  const handleRetrySplitStage = useCallback(async (phase: SplitRetryPhase) => {
    const handler = splitStageRetryHandlersRef.current[phase];
    if (!handler) {
      onWarning(`当前没有可重试的${phase === "phase1" ? "阶段1" : "阶段2"}上下文。`);
      return;
    }
    setRetryingPhase(phase);
    appendSplitRuntimeLog("system", `手动触发重试：${phase === "phase1" ? "阶段1" : "阶段2"}。`);
    try {
      await handler();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendSplitRuntimeLog(
        "error",
        `${phase === "phase1" ? "阶段1" : "阶段2"}重试失败：${msg}`,
        { retryPhase: phase },
      );
    } finally {
      setRetryingPhase(null);
    }
  }, [appendSplitRuntimeLog, onWarning]);

  const splitRuntimeInModal =
    splitPromptAdjustModalOpen && splitWizardStep === "runtime";

  useEffect(() => {
    if (!splitRuntimeVisible && !splitRuntimeInModal) return;
    const el = splitRuntimeListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [splitRuntimeVisible, splitRuntimeInModal, splitRuntimeLogs.length]);

  useEffect(() => {
    if (!splitRuntimeVisible) return;
    let rafId: number | null = null;
    const updateSplitRuntimeOverlayRect = () => {
      const overlay = splitRuntimeRef.current;
      const shell = requirementEditorShellRef.current;
      if (!overlay || !shell) return;
      const rect = shell.getBoundingClientRect();
      overlay.style.bottom = "66px";
      overlay.style.left = `${Math.max(0, rect.left)}px`;
      overlay.style.width = `${Math.max(0, rect.width)}px`;
      overlay.style.height = "360px";
      overlay.style.zIndex = "1000";
    };
    const scheduleUpdateSplitRuntimeOverlayRect = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateSplitRuntimeOverlayRect();
      });
    };
    updateSplitRuntimeOverlayRect();
    window.addEventListener("resize", scheduleUpdateSplitRuntimeOverlayRect);
    window.addEventListener("scroll", scheduleUpdateSplitRuntimeOverlayRect, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", scheduleUpdateSplitRuntimeOverlayRect);
      window.removeEventListener("scroll", scheduleUpdateSplitRuntimeOverlayRect, true);
      if (rafId != null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [requirementEditorShellRef, splitRuntimeVisible]);

  return {
    appendSplitRuntimeLog,
    handleRetrySplitStage,
    resetSplitRuntimePanel,
    retryingPhase,
    setSplitRuntimeVisible,
    splitRuntimeListRef,
    splitRuntimeLogs,
    splitRuntimeRef,
    splitRuntimeVisible,
    splitStageRetryHandlersRef,
  };
}
