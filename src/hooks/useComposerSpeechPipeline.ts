import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { message } from "antd";
import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type {
  ComposerSpeechPreferencesV1,
  ComposerSpeechSendMode,
} from "../constants/composerSpeechPreferences";
import { polishComposerSpeechTranscript } from "../services/composerSpeechPolish";
import { buildSpeechInsertion } from "../utils/composerSpeechRecognition";
import {
  detectComposerSpeechInterimTrigger,
  resolveComposerSpeechSegmentAction,
} from "../utils/composerSpeechTranscriptPipeline";
import { useComposerSpeechDictation } from "./useComposerSpeechDictation";
import { evaluateManualSegmentIdle } from "../utils/composerSpeechSegmentIdle";

export interface ComposerSpeechPipelineSurface {
  getPlain: () => string;
  getCursor?: () => number;
  setPlainAndCursor: (plain: string, cursor: number) => void;
}

export interface UseComposerSpeechPipelineOptions {
  sessionId: string;
  isSessionBusy: boolean;
  speechPrefs: ComposerSpeechPreferencesV1;
  speechPolishProjectPath: string;
  surfaceRef: RefObject<ComposerSpeechPipelineSurface | null>;
  clearComposerInput: () => void;
  onAutoSend: (plain: string) => void;
  onCancelSession: () => void;
}

function isAutoSendSpeechMode(mode: ComposerSpeechSendMode): boolean {
  return mode === "silenceAutoSend" || mode === "endingWordAutoSend";
}

/**
 * 手动模式下"段尾空闲"阈值从 `speechPrefs.manualSegmentIdleMs` 读取。
 *
 * 故意保持与 `silenceAutoSendIdleMs` 解耦：自动发送模式的"沉默 = 整段结束并发出"是不同语义，
 * 手动模式"沉默 = 一段结束但不发"是另一语义，避免相互误伤。
 */

export function useComposerSpeechPipeline({
  sessionId,
  isSessionBusy,
  speechPrefs,
  speechPolishProjectPath,
  surfaceRef,
  clearComposerInput,
  onAutoSend,
  onCancelSession,
}: UseComposerSpeechPipelineOptions) {
  const speechPrefsRef = useRef(speechPrefs);
  speechPrefsRef.current = speechPrefs;
  const speechPolishProjectPathRef = useRef(speechPolishProjectPath);
  speechPolishProjectPathRef.current = speechPolishProjectPath;

  // 当前段实时草稿（仅预览，不入框）。
  const interimRef = useRef("");
  const [speechPreviewText, setSpeechPreviewText] = useState("");
  // 后处理（整理）进行中。
  const [speechProcessing, setSpeechProcessing] = useState(false);
  const speechProcessingRef = useRef(false);
  speechProcessingRef.current = speechProcessing;
  const processingSeqRef = useRef(0);
  const processingPromiseRef = useRef<Promise<void> | null>(null);

  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualIdleLastTextRef = useRef("");
  const autoSendNextFinalRef = useRef(false);
  const segmentTriggerActedRef = useRef(false);

  const [speechKeepAliveDuringBusy, setSpeechKeepAliveDuringBusy] = useState(false);
  const speechKeepAliveDuringBusyRef = useRef(false);
  speechKeepAliveDuringBusyRef.current = speechKeepAliveDuringBusy;

  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const onCancelSessionRef = useRef(onCancelSession);
  onCancelSessionRef.current = onCancelSession;
  const clearComposerInputRef = useRef(clearComposerInput);
  clearComposerInputRef.current = clearComposerInput;

  const speechDictationRef = useRef<ReturnType<typeof useComposerSpeechDictation> | null>(null);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current != null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearManualIdleTimer = useCallback(() => {
    if (manualIdleTimerRef.current != null) {
      clearTimeout(manualIdleTimerRef.current);
      manualIdleTimerRef.current = null;
    }
    manualIdleLastTextRef.current = "";
  }, []);

  /** 清空当前段的跟踪状态（预览 / 计时器 / 触发标记 / 取消在途整理）。 */
  const resetSegmentState = useCallback(() => {
    clearSilenceTimer();
    clearManualIdleTimer();
    interimRef.current = "";
    setSpeechPreviewText("");
    autoSendNextFinalRef.current = false;
    segmentTriggerActedRef.current = false;
    processingSeqRef.current += 1; // 作废在途整理
    processingPromiseRef.current = null;
    setSpeechProcessing(false);
  }, [clearManualIdleTimer, clearSilenceTimer]);

  const insertProcessedText = useCallback(
    (processed: string) => {
      const surface = surfaceRef.current;
      const text = processed.trim();
      if (!surface || !text) return;
      const plain = surface.getPlain();
      const rawCursor = surface.getCursor?.() ?? plain.length;
      const cursor = Math.max(0, Math.min(rawCursor, plain.length));
      const { insertion, nextCursor } = buildSpeechInsertion(plain, cursor, text);
      if (!insertion) return;
      const next = plain.slice(0, cursor) + insertion + plain.slice(cursor);
      surface.setPlainAndCursor(next, nextCursor);
    },
    [surfaceRef],
  );

  const scheduleSilenceFinalize = useCallback(() => {
    if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      silenceTimerRef.current = null;
      if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
      if (segmentTriggerActedRef.current) return;
      segmentTriggerActedRef.current = true;
      autoSendNextFinalRef.current = true;
      speechDictationRef.current?.finalizeSegment({ continueListening: true });
    }, speechPrefsRef.current.silenceAutoSendIdleMs);
  }, [clearSilenceTimer]);

  /**
   * manual 模式段尾计时器：每个非空 interim 都重置（按文本去重，避免 ASR 重复回灌时反复重启）。
   * 阈值取自 `speechPrefsRef.current.manualSegmentIdleMs`（默认 1s，可在听写弹窗配置）。
   * 到期时若仍 listening 则 finalize 当前段但 `continueListening: true` 让用户继续下一段。
   * 注意：与 silenceAutoSend 共存时会互斥（silenceAutoSend 模式不会调用本函数）。
   */
  const scheduleManualSegmentIdleFinalize = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const idleMs = Math.max(
        0,
        Number.isFinite(speechPrefsRef.current.manualSegmentIdleMs)
          ? speechPrefsRef.current.manualSegmentIdleMs
          : 1000,
      );
      const decision = evaluateManualSegmentIdle({
        sendMode: speechPrefsRef.current.sendMode,
        trimmed,
        lastSeenText: manualIdleLastTextRef.current,
        segmentTriggerActed: segmentTriggerActedRef.current,
        listening: speechDictationRef.current?.listening ?? false,
        idleMs,
        now: 0, // decision.armedAt == null 路径不需要时间
        armedAt: null,
      });
      if (!decision.shouldArm) return;
      manualIdleLastTextRef.current = trimmed;
      if (manualIdleTimerRef.current != null) {
        clearTimeout(manualIdleTimerRef.current);
      }
      manualIdleTimerRef.current = setTimeout(() => {
        manualIdleTimerRef.current = null;
        const fire = evaluateManualSegmentIdle({
          sendMode: speechPrefsRef.current.sendMode,
          trimmed,
          lastSeenText: "",
          segmentTriggerActed: segmentTriggerActedRef.current,
          listening: speechDictationRef.current?.listening ?? false,
          idleMs,
          now: idleMs,
          armedAt: 0,
        });
        if (!fire.shouldFire) return;
        segmentTriggerActedRef.current = true;
        manualIdleLastTextRef.current = "";
        speechDictationRef.current?.finalizeSegment({ continueListening: true });
      }, idleMs);
    },
    [],
  );

  const handleSegmentInterim = useCallback(
    (text: string) => {
      interimRef.current = text;
      setSpeechPreviewText(text);

      const trimmed = text.trim();
      if (!trimmed) return;

      if (!segmentTriggerActedRef.current) {
        const trigger = detectComposerSpeechInterimTrigger(text, speechPrefsRef.current);
        if (trigger) {
          // 命中收尾触发：结束当前段，由 final 统一执行 clear / cancel / send。
          segmentTriggerActedRef.current = true;
          clearSilenceTimer();
          if (trigger === "send") autoSendNextFinalRef.current = true;
          speechDictationRef.current?.finalizeSegment({ continueListening: true });
          return;
        }
      }

      if (speechPrefsRef.current.sendMode === "silenceAutoSend") {
        scheduleSilenceFinalize();
      } else if (speechPrefsRef.current.sendMode === "manual") {
        scheduleManualSegmentIdleFinalize(text);
      }
    },
    [clearSilenceTimer, scheduleManualSegmentIdleFinalize, scheduleSilenceFinalize],
  );

  const executeVoiceClear = useCallback(() => {
    resetSegmentState();
    clearComposerInputRef.current();
  }, [resetSegmentState]);

  const handleSegmentFinal = useCallback(
    (segmentText: string) => {
      clearSilenceTimer();
      clearManualIdleTimer();
      interimRef.current = "";
      setSpeechPreviewText("");

      const forceAutoSend = autoSendNextFinalRef.current;
      autoSendNextFinalRef.current = false;
      segmentTriggerActedRef.current = false;

      const action = resolveComposerSpeechSegmentAction({
        segmentText,
        speechPrefs: speechPrefsRef.current,
        forceAutoSend,
      });

      if (action.type === "clear") {
        executeVoiceClear();
        return;
      }
      if (action.type === "cancel") {
        resetSegmentState();
        onCancelSessionRef.current();
        return;
      }
      if (action.type === "noop") {
        return;
      }

      const { spokenText, shouldAutoSend } = action;
      const seq = ++processingSeqRef.current;
      setSpeechProcessing(true);
      // speechPolishEnabled=true → AI 整理（带本地兜底）；false → 仅本地整理（projectPath 置空即降级）。
      const projectPath = speechPrefsRef.current.speechPolishEnabled
        ? speechPolishProjectPathRef.current
        : "";
      const promise = polishComposerSpeechTranscript(projectPath, spokenText)
        .then((processed) => {
          if (seq !== processingSeqRef.current) return;
          const finalText = processed.trim() || spokenText.trim();
          if (finalText) insertProcessedText(finalText);
          if (shouldAutoSend) {
            const plain = surfaceRef.current?.getPlain().trim() ?? "";
            if (plain) onAutoSendRef.current(plain);
          }
        })
        .catch(() => {
          if (seq !== processingSeqRef.current) return;
          const fallback = spokenText.trim();
          if (fallback) insertProcessedText(fallback);
        })
        .finally(() => {
          if (seq === processingSeqRef.current) {
            setSpeechProcessing(false);
            if (processingPromiseRef.current === promise) processingPromiseRef.current = null;
          }
        });
      processingPromiseRef.current = promise;
    },
    [clearSilenceTimer, executeVoiceClear, insertProcessedText, resetSegmentState, surfaceRef],
  );

  const handleSpeechError = useCallback((errorMessage: string) => {
    const msg = errorMessage.trim();
    if (!msg) return;
    message.warning(msg);
  }, []);

  const handleListeningEnd = useCallback(() => {
    setSpeechKeepAliveDuringBusy(false);
  }, []);

  const speechDictation = useComposerSpeechDictation({
    enabled: !isSessionBusy || speechKeepAliveDuringBusy,
    retainSessionWhenDisabled: () =>
      speechKeepAliveDuringBusyRef.current &&
      isAutoSendSpeechMode(speechPrefsRef.current.sendMode),
    speechEngineMode: speechPrefs.speechEngineMode,
    senseVoiceLang: speechPrefs.senseVoiceLang,
    continueAfterSegment: () => isAutoSendSpeechMode(speechPrefsRef.current.sendMode),
    onSegmentInterim: handleSegmentInterim,
    onSegmentFinal: handleSegmentFinal,
    onListeningEnd: handleListeningEnd,
    onError: handleSpeechError,
  });
  speechDictationRef.current = speechDictation;

  /**
   * 发送前等待在途整理完成，确保输入框里是整理后的文本。
   * 返回 true 表示确有在途整理被等待（其结果可能已插入输入框，调用方应改读刷新后的内容）。
   *
   * 无在途 promise 时同步返回 `false`（不经 `async`/`await`），避免 Enter 发送路径
   * 仅因一次空 await 就推迟输入框清空与派发。
   */
  const flushPendingSpeechForSend = useCallback((): boolean | Promise<boolean> => {
    const pending = processingPromiseRef.current;
    if (!pending) return false;
    return pending.then(
      () => true,
      () => true,
    );
  }, []);

  /** 发送清空输入框时复位听写段状态（旧 baseline 机制已移除，仅做复位）。 */
  const onComposerInputClearedForSend = useCallback(
    (_sentPlain?: string) => {
      resetSegmentState();
      // 手动模式下「边说边按发送」：当前段可能仍在采集 / 收尾且尚未整理入框；
      // 必须丢弃它，否则其稍后整理后的文本会串入下一条消息（REQ1 跨发送泄漏）。
      const dictation = speechDictationRef.current;
      if (
        dictation &&
        !isAutoSendSpeechMode(speechPrefsRef.current.sendMode) &&
        (dictation.listening || dictation.transcribing)
      ) {
        dictation.cancel();
      }
    },
    [resetSegmentState],
  );

  // 以下为旧 API 兼容（baseline/anchor 已移除，保留空实现以最小化调用方改动）。
  const finalizeTranscriptBaselineAfterSend = useCallback(() => {}, []);
  const rollbackTranscriptBaselineOnSendFailure = useCallback(() => {}, []);
  const resetStreamAnchor = useCallback(() => {}, []);

  const clearSpeechIdleAutoSendTimer = useCallback(() => {
    clearSilenceTimer();
  }, [clearSilenceTimer]);

  // 进入自动发送模式且开始听写：维持 busy 期间保活，使连续对话可跨执行排队。
  const speechListeningPrevRef = useRef(false);
  useEffect(() => {
    if (speechDictation.listening && !speechListeningPrevRef.current) {
      if (isAutoSendSpeechMode(speechPrefsRef.current.sendMode)) {
        setSpeechKeepAliveDuringBusy(true);
      }
    }
    if (!speechDictation.listening && !speechDictation.transcribing && speechListeningPrevRef.current) {
      setSpeechKeepAliveDuringBusy(false);
    }
    speechListeningPrevRef.current = speechDictation.listening;
  }, [speechDictation.listening, speechDictation.transcribing]);

  useEffect(() => {
    if (speechPrefs.sendMode !== "silenceAutoSend") {
      clearSilenceTimer();
    }
    if (speechPrefs.sendMode !== "manual") {
      clearManualIdleTimer();
    }
  }, [clearManualIdleTimer, clearSilenceTimer, speechPrefs.sendMode]);

  // 会话切换：彻底复位并停止听写（绝不把上个会话的语音带入下个会话）。
  useEffect(() => {
    resetSegmentState();
    speechDictation.cancel();
    setSpeechKeepAliveDuringBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => () => clearSilenceTimer(), [clearSilenceTimer]);
  useEffect(() => () => clearManualIdleTimer(), [clearManualIdleTimer]);

  return {
    speechDictation,
    speechPreviewText,
    speechProcessing,
    // 兼容旧命名：mic 按钮 loading 等仍读取 speechPolishing。
    speechPolishing: speechProcessing,
    speechKeepAliveDuringBusy,
    flushPendingSpeechForSend,
    finalizeTranscriptBaselineAfterSend,
    rollbackTranscriptBaselineOnSendFailure,
    onComposerInputClearedForSend,
    resetStreamAnchor,
    clearSpeechIdleAutoSendTimer,
  };
}

export type { ComposerSpeechEngine };
