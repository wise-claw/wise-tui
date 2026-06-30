import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { message } from "antd";
import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type {
  ComposerSpeechPreferencesV1,
  ComposerSpeechSendMode,
} from "../constants/composerSpeechPreferences";
import { polishComposerSpeechTranscript } from "../services/composerSpeechPolish";
import { applyLocalSpeechPolishFallback } from "../utils/composerSpeechPolish";
import {
  processComposerSpeechTranscriptUpdate,
  shouldUseLlmSpeechPolish,
} from "../utils/composerSpeechTranscriptPipeline";
import {
  advanceBaselineIfExtendedByRaw,
  commitComposerSpeechTranscriptBaselineForSend,
  createComposerSpeechStreamAnchor,
  normalizeSpeechPlainForCompare,
  pickLongerSpeechBaseline,
  resolveComposerSpeechDisplayText,
  stripClearedRawPrefix,
  stripComposerSpeechDeltaOverlap,
  stripSpeechCompareNoise,
} from "../utils/composerSpeechStreaming";
import { shouldRescheduleSpeechIdleAutoSend } from "../utils/composerSpeechSilenceIdle";
import {
  createPolishFallbackNotifyState,
  markPolishFallbackIfNeeded,
  watchPolishFallback,
} from "../utils/composerSpeechPolishFallback";
import { useComposerSpeechDictation } from "./useComposerSpeechDictation";

export interface ComposerSpeechPipelineSurface {
  getPlain: () => string;
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
 * 双阶段 polish 阶段 2 覆盖短路：LLM resolve 后覆盖前判断是否应跳过 setPlainAndCursor。
 *
 * - `currentSurfacePlain` = 阶段 1 写完后用户实际在屏幕上看到的输入框文本（可能含用户手改）
 * - `immediatePlain`     = 阶段 1 hook 自己 `applyLocalSpeechPolishFallback` 写出的本地整理版
 * - `polishedPlain`      = 阶段 2 LLM resolve 后的覆盖候选
 *
 * 返回 true（跳过覆盖）当：
 *   1) 用户已在阶段 1 之后改过字（surface 剥标点/空白后与 immediate 不一致）→ 绝不能覆盖，丢字
 *   2) polished 与 immediate 等价（剥标点/空白后一致）→ 覆盖无意义，仅触发输入框抖动
 *
 * 函数保留为导出供单测（与 baselineReducer 同风格）。
 */
export function shouldSkipPolishedOverlay(
  currentSurfacePlain: string,
  immediatePlain: string,
  polishedPlain: string,
): boolean {
  const surfaceCmp = normalizeSpeechPlainForCompare(currentSurfacePlain);
  const immediateCmp = normalizeSpeechPlainForCompare(immediatePlain);
  if (surfaceCmp && surfaceCmp !== immediateCmp) {
    // 用户已在阶段 1 之后修改过输入框，绝不覆盖。
    return true;
  }
  const polishedCmp = normalizeSpeechPlainForCompare(polishedPlain);
  if (polishedCmp === immediateCmp) {
    // polished 与本地整理版无实质差异，覆盖只会触发 setPlainAndCursor + Tiptap 重渲染。
    return true;
  }
  return false;
}

// ---------- Baseline reducer 子状态机 ----------
interface BaselineState {
  baseline: string;
  rollback: string | null;
  prepared: boolean;
}

type BaselineAction =
  | {
      type: "BASELINE_PREPARE";
      baseline: string;
      rollback: string | null;
      sentPlain?: string;
    }
  | { type: "BASELINE_FINALIZE" }
  | { type: "BASELINE_ROLLBACK" }
  | { type: "BASELINE_RESET" }
  | { type: "BASELINE_ADVANCE"; raw: string };

const BASELINE_INITIAL: BaselineState = { baseline: "", rollback: null, prepared: false };

/** Baseline 子状态机：commit（带快照）/ finalize / rollback / reset / advance 五动作。 */
export function baselineReducer(state: BaselineState, action: BaselineAction): BaselineState {
  switch (action.type) {
    case "BASELINE_PREPARE": {
      const next: BaselineState = {
        baseline: action.baseline,
        rollback: action.rollback,
        prepared: true,
      };
      return next;
    }
    case "BASELINE_FINALIZE": {
      if (!state.prepared && state.rollback == null) return state;
      return { baseline: state.baseline, rollback: null, prepared: false };
    }
    case "BASELINE_ROLLBACK": {
      if (state.rollback == null) return state;
      return { baseline: state.rollback, rollback: null, prepared: false };
    }
    case "BASELINE_RESET": {
      return BASELINE_INITIAL;
    }
    case "BASELINE_ADVANCE": {
      const advanced = advanceBaselineIfExtendedByRaw(state.baseline, action.raw);
      if (advanced === state.baseline) return state;
      return { ...state, baseline: advanced };
    }
  }
}

// ---------- Baseline 同步写入原语 ----------
// 原来 hook 用 useReducer + baselineStateRef.current 镜像写 baseline 三件套。
// 这导致一个时序陷阱：dispatchBaseline 同步执行 reducer 但 state 入 React
// 内部，ref 镜像要等下一次 render 才更新。`triggerComposerSpeechAutoSend`
// 内同步走 `dispatchBaseline(PREPARE) → onAutoSend(plain) → handleSend →
// clearComposerSurfaceSync → onComposerInputClearedForSend`，后者读
// `baselineStateRef.current.prepared` 时还是旧值（false），错走 prepare
// + finalize 分支，把 rollback 字段清空，发送失败时
// `rollbackTranscriptBaselineOnSendFailure` 拿到 rollback=null 静默 no-op。
//
// 修法：把 baseline 改成 useRef + 一组 `applyBaseline*` 同步 helper，
// 写入立刻生效，hook 内的 `baselineStateRef.current.*` 读点语义不变。
// `baselineReducer` 纯函数保留供单测覆盖状态机契约（`useComposerSpeechPipeline.reducer.test.ts`）。

export type BaselineRef = { current: BaselineState };

export function applyBaselinePrepare(
  ref: BaselineRef,
  payload: { baseline: string; rollback: string | null; sentPlain?: string },
): void {
  ref.current = {
    baseline: payload.baseline,
    rollback: payload.rollback,
    prepared: true,
  };
}

export function applyBaselineFinalize(ref: BaselineRef): void {
  const cur = ref.current;
  if (!cur.prepared && cur.rollback == null) return;
  ref.current = { baseline: cur.baseline, rollback: null, prepared: false };
}

export function applyBaselineRollback(ref: BaselineRef): void {
  const cur = ref.current;
  if (cur.rollback == null) return;
  ref.current = { baseline: cur.rollback, rollback: null, prepared: false };
}

export function applyBaselineReset(ref: BaselineRef): void {
  ref.current = { baseline: "", rollback: null, prepared: false };
}

export function applyBaselineAdvance(ref: BaselineRef, raw: string): void {
  const cur = ref.current;
  const advanced = advanceBaselineIfExtendedByRaw(cur.baseline, raw);
  if (advanced === cur.baseline) return;
  ref.current = { ...cur, baseline: advanced };
}

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

  // ---------- baseline 状态（useRef 同步写，避免 useReducer 同步陷阱）----------
  // 历史上 useReducer 化：dispatch 后 ref 镜像要等 render 才更新，触发同步
  // prepare → onAutoSend → onComposerInputClearedForSend 时 prepared 误读
  // 为 false，把 rollback 字段清空。改用 useRef + 同步 applyBaseline* helper。
  const baselineStateRef = useRef<BaselineState>(BASELINE_INITIAL);

  // ---------- 其它 ref 状态（不在渲染路径上）----------
  const speechStreamAnchorRef = useRef<ReturnType<typeof createComposerSpeechStreamAnchor> | null>(
    null,
  );
  const lastRawSpeechTranscriptRef = useRef("");
  const speechLastSentPlainRef = useRef("");
  const speechIdleAutoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 根因 #1：仅当 plain normalize 后发生变化才重排 idle 计时器。 */
  const speechLastPlainCompareRef = useRef("");
  /** 根因 #2：executeVoiceClearComposer 时 snapshot 当前 lastRaw，下一帧入口先剥离。 */
  const lastClearedRawRef = useRef("");
  /** 根因 #4：用 AbortController 替代 speechPolishSeqRef，避免 ghost render。 */
  const polishAbortRef = useRef<AbortController | null>(null);
  const suffixAutoSendFiredRef = useRef(false);
  /** LLM polish 失败提示去重状态：连续失败 60s 窗口内只 toast 一次。 */
  const polishFallbackNotifyRef = useRef(createPolishFallbackNotifyState());
  const POLISH_LLM_TIMEOUT_MS = 5_000;

  const [speechPolishing, setSpeechPolishing] = useState(false);
  const [speechKeepAliveDuringBusy, setSpeechKeepAliveDuringBusy] = useState(false);
  const speechKeepAliveDuringBusyRef = useRef(false);
  speechKeepAliveDuringBusyRef.current = speechKeepAliveDuringBusy;

  const onAutoSendRef = useRef(onAutoSend);
  onAutoSendRef.current = onAutoSend;
  const onCancelSessionRef = useRef(onCancelSession);
  onCancelSessionRef.current = onCancelSession;
  const clearComposerInputRef = useRef(clearComposerInput);
  clearComposerInputRef.current = clearComposerInput;

  // ---------- 工具函数：拆分的 polish abort 原语 ----------
  // 双阶段 polish 在连续口播时新 promise 启动不应立即 setPolishing(false)
  // （否则会闪 false→true），故拆为三个原语：
  // - abortPolishController：仅短路旧 controller 的覆盖副作用（不杀 promise 本身）
  // - setSpeechPolishingFalse：仅关 loading UI（调用方需自行判断是否有活跃 promise）
  // - abortPolish：复合版（abort + 关 loading），用于"用户明确终止 polish 链"的场景
  const abortPolishController = useCallback(() => {
    polishAbortRef.current?.abort();
    polishAbortRef.current = null;
  }, []);
  const setSpeechPolishingFalse = useCallback(() => setSpeechPolishing(false), []);
  const abortPolish = useCallback(() => {
    abortPolishController();
    setSpeechPolishingFalse();
  }, [abortPolishController, setSpeechPolishingFalse]);

  const clearSpeechIdleAutoSendTimer = useCallback(() => {
    if (speechIdleAutoSendTimerRef.current != null) {
      clearTimeout(speechIdleAutoSendTimerRef.current);
      speechIdleAutoSendTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSpeechIdleAutoSendTimer(), [clearSpeechIdleAutoSendTimer]);
  useEffect(() => () => abortPolish(), [abortPolish]);

  // ---------- triggerComposerSpeechAutoSend ----------
  const triggerComposerSpeechAutoSend = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rawPlain = surface.getPlain().trim();
    if (!rawPlain) return;
    const stripped = stripComposerSpeechDeltaOverlap(rawPlain, speechLastSentPlainRef.current);
    const plain = resolveComposerSpeechDisplayText(stripped).plain;
    if (!plain) return;
    if (plain !== rawPlain) {
      speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
      surface.setPlainAndCursor(plain, plain.length);
    }
    const lastRaw = lastRawSpeechTranscriptRef.current.trim();
    const newBaseline = commitComposerSpeechTranscriptBaselineForSend(
      baselineStateRef.current.baseline,
      lastRaw,
      plain,
    );
    // 根因 #3：silent auto-send 触发瞬间，ASR 停顿期可能还有未推送尾部。
    // 先 commit baseline，再兜底推进到 lastRaw（若 lastRaw 是扩展）。
    applyBaselinePrepare(baselineStateRef, {
      baseline: newBaseline,
      rollback: baselineStateRef.current.baseline,
      sentPlain: plain,
    });
    applyBaselineAdvance(baselineStateRef, lastRaw);
    // 根因 #4：同步把已发送 plain 写入 speechLastSentPlainRef，
    // 下一帧 ASR partial 进入 pipeline 时，stripComposerSpeechDeltaOverlap
    // 能正确剥掉已发送段，避免「发送后再说话把历史带进来」。
    // 必须同步写——onAutoSend 同步链上一旦没有这个值，后续 ASR frame 的
    // lastSentPlain 拿不到，delta 重叠剥离失效。
    speechLastSentPlainRef.current = plain;
    speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
    abortPolish();
    suffixAutoSendFiredRef.current = false;
    speechLastPlainCompareRef.current = ""; // 已发送，下一轮从空白开始比
    onAutoSendRef.current(plain);
  }, [abortPolish, surfaceRef]);

  // ---------- scheduleSpeechIdleAutoSend（根因 #1：plain 变化才重排）----------
  const scheduleSpeechIdleAutoSend = useCallback(() => {
    if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
    clearSpeechIdleAutoSendTimer();
    speechIdleAutoSendTimerRef.current = setTimeout(() => {
      speechIdleAutoSendTimerRef.current = null;
      if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
      triggerComposerSpeechAutoSend();
    }, speechPrefsRef.current.silenceAutoSendIdleMs);
  }, [clearSpeechIdleAutoSendTimer, triggerComposerSpeechAutoSend]);

  // ---------- applySpeechUtteranceToComposer ----------
  const applySpeechUtteranceToComposer = useCallback(
    (spokenText: string, shouldAutoSend: boolean) => {
      const surface = surfaceRef.current;
      if (!surface) return;

      const { plain, cursor } = resolveComposerSpeechDisplayText(spokenText);
      const lastSent = speechLastSentPlainRef.current;
      const sentCmp = stripSpeechCompareNoise(lastSent);
      const plainCmp = stripSpeechCompareNoise(plain);
      if (plain) {
        if (sentCmp && plainCmp === sentCmp && !shouldAutoSend) {
          return;
        }
        speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
        surface.setPlainAndCursor(plain, cursor);
        if (lastSent && sentCmp && !plainCmp.startsWith(sentCmp)) {
          speechLastSentPlainRef.current = "";
        }
      } else if (!shouldAutoSend) {
        return;
      }

      // 根因 #1：仅当 plain normalize 后变化才重排 idle 计时器，
      // 避免静音期 ASR 持续推 partial 导致计时器无限重排。
      if (
        plain &&
        speechPrefsRef.current.sendMode === "silenceAutoSend" &&
        shouldRescheduleSpeechIdleAutoSend(speechLastPlainCompareRef.current, plain)
      ) {
        speechLastPlainCompareRef.current = normalizeSpeechPlainForCompare(plain);
        scheduleSpeechIdleAutoSend();
      }

      if (shouldAutoSend && !suffixAutoSendFiredRef.current) {
        suffixAutoSendFiredRef.current = true;
        clearSpeechIdleAutoSendTimer();
        triggerComposerSpeechAutoSend();
      }
    },
    [
      clearSpeechIdleAutoSendTimer,
      scheduleSpeechIdleAutoSend,
      surfaceRef,
      triggerComposerSpeechAutoSend,
    ],
  );

  // ---------- executeVoiceClearComposer（根因 #2 修复点）----------
  const executeVoiceClearComposer = useCallback(() => {
    abortPolish();
    clearSpeechIdleAutoSendTimer();
    speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
    speechLastSentPlainRef.current = "";
    speechLastPlainCompareRef.current = "";
    suffixAutoSendFiredRef.current = false;
    applyBaselineReset(baselineStateRef);
    // snapshot 当前 lastRaw，下一帧入口先剥离。
    const lastRaw = lastRawSpeechTranscriptRef.current.trim();
    if (lastRaw) {
      lastClearedRawRef.current = lastRaw;
    }
    // pickLongerSpeechBaseline 推进 baseline（保留既有行为）。
    if (lastRaw) {
      applyBaselinePrepare(baselineStateRef, {
        baseline: pickLongerSpeechBaseline(baselineStateRef.current.baseline, lastRaw),
        rollback: null,
      });
    }
    clearComposerInputRef.current();
  }, [abortPolish, clearSpeechIdleAutoSendTimer]);

  const speechDictationEngineRef = useRef<ComposerSpeechEngine | null>(null);

  // ---------- handleSpeechTranscriptUpdate ----------
  const handleSpeechTranscriptUpdate = useCallback(
    ({ text, isFinal }: { text: string; isFinal: boolean }) => {
      lastRawSpeechTranscriptRef.current = text;
      const action = processComposerSpeechTranscriptUpdate({
        engine: speechDictationEngineRef.current,
        baseline: baselineStateRef.current.baseline,
        lastSentPlain: speechLastSentPlainRef.current,
        rawTranscript: text,
        isFinal,
        lastClearedRaw: lastClearedRawRef.current,
        speechPrefs: speechPrefsRef.current,
      });

      if (action.type === "clear") {
        // 根因 #2 防递归 guard：若本帧 rawTranscript 与上次 snapshot 完全一致，
        // 直接 noop（不再嵌套调 executeVoiceClearComposer）。
        if (
          lastClearedRawRef.current &&
          stripSpeechCompareNoise(text) === stripSpeechCompareNoise(lastClearedRawRef.current)
        ) {
          speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
          return;
        }
        executeVoiceClearComposer();
        return;
      }
      if (action.type === "cancel") {
        abortPolish();
        clearSpeechIdleAutoSendTimer();
        onCancelSessionRef.current();
        return;
      }
      if (action.type === "noop") {
        return;
      }

      // 已被 stripped 的清空前缀：消费完清掉 ref，避免影响后续不带清空段的帧。
      if (lastClearedRawRef.current && stripClearedRawPrefix(text, lastClearedRawRef.current) !== text.trim()) {
        lastClearedRawRef.current = "";
      }

      const { spokenText, shouldAutoSend } = action;

      // ---------- 双阶段 polish ----------
      // 阶段 1（T0 ~0ms）：本地 fallback 立即写输入框，给用户即时反馈；
      // silent/endingWord 模式下阶段 1 就能直接触发 auto-send，不必等 LLM。
      const immediatePlain = applyLocalSpeechPolishFallback(spokenText) || spokenText;
      applySpeechUtteranceToComposer(immediatePlain, shouldAutoSend);

      // 阶段 2（~1s）：后台 LLM polish，完成后用 polished 覆盖输入框。
      // AbortController 防 stale 覆盖：新 utterance 进来时短路旧 controller 的覆盖回调，
      // 但不杀旧 promise 本身（保留旧 LLM 自然 resolve，避免浪费已发起的调用）。
      // 若 polish 关或本段为口播发送，跳过阶段 2（避免 LLM polish 后又触发 auto-send 重复）。
      // 短句且无 filler（service 快路径口径）直接跳过阶段 2：避免 UI 短暂闪 loading。
      const polishEnabled = speechPrefsRef.current.speechPolishEnabled;
      if (!polishEnabled || shouldAutoSend) return;
      if (!shouldUseLlmSpeechPolish(spokenText)) return;

      const controller = new AbortController();
      polishAbortRef.current?.abort();
      polishAbortRef.current = controller;
      setSpeechPolishing(true);
      // service 内部已 try/catch 兜底到本地 fallback，无法靠 reject 区分"成功"与"失败"。
      // 用 5s 超时推断失败：超时说明 LLM 没回，回落到的本地版已经由阶段 1 写进输入框。
      const watch = watchPolishFallback(
        () => polishComposerSpeechTranscript(speechPolishProjectPath, spokenText),
        { timeoutMs: POLISH_LLM_TIMEOUT_MS },
      );
      void watch.result
        .then((polished) => {
          if (controller.signal.aborted) return;
          if (watch.isFailed()) {
            if (markPolishFallbackIfNeeded(polishFallbackNotifyRef.current, Date.now())) {
              message.warning("语音整理未在 5 秒内返回，已使用本地清理版本");
            }
            return;
          }
          // polished 后已经"被整理过"，不再触发 auto-send。
          const polishedPlain = applyLocalSpeechPolishFallback(polished) || polished;
          // 短路：用户已改字 / polished 与本地版等价 → 跳过 setPlainAndCursor 避免输入框抖动。
          const surface = surfaceRef.current;
          const currentSurfacePlain = surface?.getPlain() ?? immediatePlain;
          if (shouldSkipPolishedOverlay(currentSurfacePlain, immediatePlain, polishedPlain)) {
            return;
          }
          applySpeechUtteranceToComposer(polishedPlain, false);
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          if (polishAbortRef.current === controller) {
            polishAbortRef.current = null;
            setSpeechPolishing(false);
          }
        });
    },
    [
      applySpeechUtteranceToComposer,
      abortPolish,
      clearSpeechIdleAutoSendTimer,
      executeVoiceClearComposer,
      speechPolishProjectPath,
    ],
  );

  const handleSpeechError = useCallback((errorMessage: string) => {
    const msg = errorMessage.trim();
    if (!msg) return;
    message.warning(msg);
  }, []);

  const resetSpeechTrackingState = useCallback(() => {
    speechStreamAnchorRef.current = null;
    lastRawSpeechTranscriptRef.current = "";
    speechLastSentPlainRef.current = "";
    speechLastPlainCompareRef.current = "";
    lastClearedRawRef.current = "";
    suffixAutoSendFiredRef.current = false;
    // 重置 polish 失败去重窗口：换会话/重置时让下一次失败能立刻 toast。
    polishFallbackNotifyRef.current = createPolishFallbackNotifyState();
    applyBaselineReset(baselineStateRef);
  }, []);

  const handleSpeechSessionEnd = useCallback(() => {
    abortPolish();
    resetSpeechTrackingState();
  }, [abortPolish, resetSpeechTrackingState]);

  const speechDictation = useComposerSpeechDictation({
    enabled: !isSessionBusy || speechKeepAliveDuringBusy,
    retainSessionWhenDisabled: () =>
      speechKeepAliveDuringBusyRef.current &&
      isAutoSendSpeechMode(speechPrefsRef.current.sendMode),
    speechEngineMode: speechPrefs.speechEngineMode,
    senseVoiceLang: speechPrefs.senseVoiceLang,
    onTranscriptUpdate: handleSpeechTranscriptUpdate,
    onSessionEnd: handleSpeechSessionEnd,
    onError: handleSpeechError,
  });

  speechDictationEngineRef.current = speechDictation.engine;

  const finalizeTranscriptBaselineAfterSend = useCallback(() => {
    applyBaselineFinalize(baselineStateRef);
  }, []);

  const rollbackTranscriptBaselineOnSendFailure = useCallback(() => {
    abortPolish();
    applyBaselineRollback(baselineStateRef);
    speechLastSentPlainRef.current = "";
  }, [abortPolish]);

  const onComposerInputClearedForSend = useCallback(
    (sentPlain?: string) => {
      abortPolish();
      clearSpeechIdleAutoSendTimer();
      if (!baselineStateRef.current.prepared) {
        const lastRaw = lastRawSpeechTranscriptRef.current.trim();
        const sent = sentPlain?.trim() ?? "";
        const newBaseline = commitComposerSpeechTranscriptBaselineForSend(
          baselineStateRef.current.baseline,
          lastRaw,
          sent,
        );
        applyBaselinePrepare(baselineStateRef, {
          baseline: newBaseline,
          rollback: baselineStateRef.current.baseline,
          sentPlain: sent,
        });
      }
      applyBaselineFinalize(baselineStateRef);
      speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
      suffixAutoSendFiredRef.current = false;
    },
    [abortPolish, clearSpeechIdleAutoSendTimer],
  );

  const resetStreamAnchor = useCallback(() => {
    speechStreamAnchorRef.current = null;
  }, []);

  useEffect(() => {
    if (speechPrefs.sendMode === "manual") {
      clearSpeechIdleAutoSendTimer();
    }
  }, [clearSpeechIdleAutoSendTimer, speechPrefs.sendMode]);

  const speechListeningPrevRef = useRef(false);
  useEffect(() => {
    if (speechDictation.listening && !speechListeningPrevRef.current) {
      if (!speechKeepAliveDuringBusyRef.current) {
        resetSpeechTrackingState();
      }
      clearSpeechIdleAutoSendTimer();
      if (isAutoSendSpeechMode(speechPrefsRef.current.sendMode)) {
        setSpeechKeepAliveDuringBusy(true);
      }
    }
    if (
      !speechDictation.listening &&
      !speechDictation.transcribing &&
      speechListeningPrevRef.current
    ) {
      setSpeechKeepAliveDuringBusy(false);
    }
    speechListeningPrevRef.current = speechDictation.listening;
  }, [
    clearSpeechIdleAutoSendTimer,
    resetSpeechTrackingState,
    speechDictation.listening,
    speechDictation.transcribing,
  ]);

  useEffect(() => {
    resetSpeechTrackingState();
    speechDictation.stop();
    setSpeechKeepAliveDuringBusy(false);
    clearSpeechIdleAutoSendTimer();
  }, [sessionId, speechDictation.stop, clearSpeechIdleAutoSendTimer, resetSpeechTrackingState]);

  return {
    speechDictation,
    speechPolishing,
    speechKeepAliveDuringBusy,
    finalizeTranscriptBaselineAfterSend,
    rollbackTranscriptBaselineOnSendFailure,
    onComposerInputClearedForSend,
    resetStreamAnchor,
    clearSpeechIdleAutoSendTimer,
  };
}