import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { message } from "antd";
import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type {
  ComposerSpeechPreferencesV1,
  ComposerSpeechSendMode,
} from "../constants/composerSpeechPreferences";
import { polishComposerSpeechTranscript } from "../services/composerSpeechPolish";
import { applyLocalSpeechPolishFallback } from "../utils/composerSpeechPolish";
import { processComposerSpeechTranscriptUpdate } from "../utils/composerSpeechTranscriptPipeline";
import {
  commitComposerSpeechTranscriptBaselineForSend,
  createComposerSpeechStreamAnchor,
  pickLongerSpeechBaseline,
  resolveComposerSpeechDisplayText,
  stripComposerSpeechDeltaOverlap,
  stripSpeechCompareNoise,
} from "../utils/composerSpeechStreaming";
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

  const speechStreamAnchorRef = useRef<ReturnType<typeof createComposerSpeechStreamAnchor> | null>(
    null,
  );
  const speechEngineTranscriptBaselineRef = useRef("");
  const speechEngineTranscriptBaselineRollbackRef = useRef<string | null>(null);
  const speechBaselinePreparedForSendRef = useRef(false);
  const lastRawSpeechTranscriptRef = useRef("");
  const speechLastSentPlainRef = useRef("");
  const speechIdleAutoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechPolishSeqRef = useRef(0);
  const suffixAutoSendFiredRef = useRef(false);
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

  const clearSpeechIdleAutoSendTimer = useCallback(() => {
    if (speechIdleAutoSendTimerRef.current != null) {
      clearTimeout(speechIdleAutoSendTimerRef.current);
      speechIdleAutoSendTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSpeechIdleAutoSendTimer(), [clearSpeechIdleAutoSendTimer]);

  const prepareTranscriptBaselineForSend = useCallback((sentPlain?: string) => {
    const lastRaw = lastRawSpeechTranscriptRef.current.trim();
    const sent = sentPlain?.trim() ?? "";
    if (!lastRaw && !sent) return;

    speechEngineTranscriptBaselineRollbackRef.current = speechEngineTranscriptBaselineRef.current;
    speechEngineTranscriptBaselineRef.current = commitComposerSpeechTranscriptBaselineForSend(
      speechEngineTranscriptBaselineRef.current,
      lastRaw,
      sent,
    );
    if (sent) {
      speechLastSentPlainRef.current = sent;
    }
    speechBaselinePreparedForSendRef.current = true;
  }, []);

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
    prepareTranscriptBaselineForSend(plain);
    speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
    speechPolishSeqRef.current += 1;
    setSpeechPolishing(false);
    suffixAutoSendFiredRef.current = false;
    onAutoSendRef.current(plain);
  }, [prepareTranscriptBaselineForSend, surfaceRef]);

  const scheduleSpeechIdleAutoSend = useCallback(() => {
    if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
    clearSpeechIdleAutoSendTimer();
    speechIdleAutoSendTimerRef.current = setTimeout(() => {
      speechIdleAutoSendTimerRef.current = null;
      if (speechPrefsRef.current.sendMode !== "silenceAutoSend") return;
      triggerComposerSpeechAutoSend();
    }, speechPrefsRef.current.silenceAutoSendIdleMs);
  }, [clearSpeechIdleAutoSendTimer, triggerComposerSpeechAutoSend]);

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

      if (plain && speechPrefsRef.current.sendMode === "silenceAutoSend") {
        scheduleSpeechIdleAutoSend();
      }

      if (shouldAutoSend && !suffixAutoSendFiredRef.current) {
        suffixAutoSendFiredRef.current = true;
        clearSpeechIdleAutoSendTimer();
        triggerComposerSpeechAutoSend();
      }
    },
    [clearSpeechIdleAutoSendTimer, scheduleSpeechIdleAutoSend, surfaceRef, triggerComposerSpeechAutoSend],
  );

  const executeVoiceClearComposer = useCallback(() => {
    speechPolishSeqRef.current += 1;
    setSpeechPolishing(false);
    clearSpeechIdleAutoSendTimer();
    speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
    speechLastSentPlainRef.current = "";
    suffixAutoSendFiredRef.current = false;
    speechBaselinePreparedForSendRef.current = false;
    speechEngineTranscriptBaselineRollbackRef.current = null;
    const lastRaw = lastRawSpeechTranscriptRef.current.trim();
    if (lastRaw) {
      speechEngineTranscriptBaselineRef.current = pickLongerSpeechBaseline(
        speechEngineTranscriptBaselineRef.current,
        lastRaw,
      );
    }
    clearComposerInputRef.current();
  }, [clearSpeechIdleAutoSendTimer]);

  const speechDictationEngineRef = useRef<ComposerSpeechEngine | null>(null);

  const handleSpeechTranscriptUpdate = useCallback(
    ({ text, isFinal }: { text: string; isFinal: boolean }) => {
      lastRawSpeechTranscriptRef.current = text;
      const action = processComposerSpeechTranscriptUpdate({
        engine: speechDictationEngineRef.current,
        baseline: speechEngineTranscriptBaselineRef.current,
        lastSentPlain: speechLastSentPlainRef.current,
        rawTranscript: text,
        isFinal,
        speechPrefs: speechPrefsRef.current,
      });

      if (action.type === "clear") {
        executeVoiceClearComposer();
        return;
      }
      if (action.type === "cancel") {
        clearSpeechIdleAutoSendTimer();
        onCancelSessionRef.current();
        return;
      }
      if (action.type === "noop") {
        return;
      }

      const { spokenText, shouldAutoSend, useLlmPolish } = action;
      if (!useLlmPolish) {
        const normalized = applyLocalSpeechPolishFallback(spokenText) || spokenText;
        applySpeechUtteranceToComposer(normalized, shouldAutoSend);
        return;
      }

      const seq = ++speechPolishSeqRef.current;
      setSpeechPolishing(true);
      void polishComposerSpeechTranscript(speechPolishProjectPath, spokenText)
        .then((polished) => {
          if (seq !== speechPolishSeqRef.current) return;
          applySpeechUtteranceToComposer(polished, shouldAutoSend);
        })
        .finally(() => {
          if (seq === speechPolishSeqRef.current) {
            setSpeechPolishing(false);
          }
        });
    },
    [
      applySpeechUtteranceToComposer,
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
    speechEngineTranscriptBaselineRef.current = "";
    speechEngineTranscriptBaselineRollbackRef.current = null;
    speechBaselinePreparedForSendRef.current = false;
    lastRawSpeechTranscriptRef.current = "";
    speechLastSentPlainRef.current = "";
    suffixAutoSendFiredRef.current = false;
  }, []);

  const handleSpeechSessionEnd = useCallback(() => {
    resetSpeechTrackingState();
  }, [resetSpeechTrackingState]);

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
    speechEngineTranscriptBaselineRollbackRef.current = null;
  }, []);

  const rollbackTranscriptBaselineOnSendFailure = useCallback(() => {
    if (speechEngineTranscriptBaselineRollbackRef.current == null) {
      return;
    }
    speechEngineTranscriptBaselineRef.current = speechEngineTranscriptBaselineRollbackRef.current;
    speechEngineTranscriptBaselineRollbackRef.current = null;
    speechBaselinePreparedForSendRef.current = false;
    speechLastSentPlainRef.current = "";
  }, []);

  const onComposerInputClearedForSend = useCallback(
    (sentPlain?: string) => {
      speechPolishSeqRef.current += 1;
      setSpeechPolishing(false);
      clearSpeechIdleAutoSendTimer();
      if (!speechBaselinePreparedForSendRef.current) {
        prepareTranscriptBaselineForSend(sentPlain);
      }
      speechBaselinePreparedForSendRef.current = false;
      speechStreamAnchorRef.current = createComposerSpeechStreamAnchor("", 0);
      suffixAutoSendFiredRef.current = false;
    },
    [clearSpeechIdleAutoSendTimer, prepareTranscriptBaselineForSend],
  );

  const isBaselinePreparedForSend = useCallback(() => speechBaselinePreparedForSendRef.current, []);

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
    prepareTranscriptBaselineForSend,
    finalizeTranscriptBaselineAfterSend,
    rollbackTranscriptBaselineOnSendFailure,
    onComposerInputClearedForSend,
    isBaselinePreparedForSend,
    resetStreamAnchor,
    clearSpeechIdleAutoSendTimer,
  };
}
