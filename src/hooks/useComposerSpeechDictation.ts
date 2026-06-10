import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureComposerMicrophoneAccess,
  openComposerMicrophonePrivacySettings,
} from "../services/composerMicrophone";
import {
  listenComposerSpeechTranscript,
} from "../services/composerLocalSpeech";
import {
  appendComposerSherpaStreamingSpeechPcm,
  cancelComposerSherpaStreamingSpeech,
  finishComposerSherpaStreamingSpeech,
  isComposerSherpaSpeechPreferred,
  listenComposerSherpaModelsStatus,
  resetComposerSherpaSpeechCacheForTests,
  startComposerSherpaStreamingSpeech,
} from "../services/composerSherpaSpeech";
import {
  ComposerAudioRecorder,
  float32ToBase64,
  mergeFloat32Chunks,
  resampleFloat32Linear,
} from "../utils/composerAudioCapture";
import {
  collectLiveSpeechTranscript,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  speechRecognitionErrorMessage,
  type SpeechRecognitionLike,
} from "../utils/composerSpeechRecognition";
import { isTauri } from "@tauri-apps/api/core";
import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type { ComposerSpeechEnginePreference, SenseVoiceLanguagePreference } from "../constants/composerSpeechPreferences";
import { resolveComposerSpeechEngine } from "../utils/composerSpeechEngine";
import { senseVoiceLangToInvokeArg } from "../utils/senseVoiceLang";

export type { ComposerSpeechEngine };

export interface ComposerSpeechTranscriptUpdate {
  text: string;
  isFinal: boolean;
}

export interface UseComposerSpeechDictationOptions {
  /** 为 false 时不启动识别（例如会话占用中）。 */
  enabled?: boolean;
  /** enabled 变为 false 时若返回 true，则不自动 stop（连续听写 + 自动发送场景）。 */
  retainSessionWhenDisabled?: () => boolean;
  /** BCP-47 语言，默认 zh-CN（Web Speech）。 */
  lang?: string;
  /** 听写引擎策略，默认 auto。 */
  speechEngineMode?: ComposerSpeechEnginePreference;
  /** SenseVoice 识别语言（仅 Sherpa 引擎生效）。 */
  senseVoiceLang?: SenseVoiceLanguagePreference;
  /** 流式 partial 或 final 更新（边说边出字）。 */
  onTranscriptUpdate: (update: ComposerSpeechTranscriptUpdate) => void;
  /** 整段听写结束。 */
  onSessionEnd?: () => void;
  onError?: (message: string) => void;
}

const PCM_FLUSH_MS = 120;

export function useComposerSpeechDictation({
  enabled = true,
  retainSessionWhenDisabled,
  lang = "zh-CN",
  speechEngineMode = "auto",
  senseVoiceLang = "auto",
  onTranscriptUpdate,
  onSessionEnd,
  onError,
}: UseComposerSpeechDictationOptions) {
  const [engine, setEngine] = useState<ComposerSpeechEngine | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const listeningRef = useRef(false);
  const transcribingRef = useRef(false);
  const wantListeningRef = useRef(false);
  listeningRef.current = listening;
  transcribingRef.current = transcribing;
  const recorderRef = useRef<ComposerAudioRecorder | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const targetSampleRateRef = useRef(16_000);
  const captureSampleRateRef = useRef(16_000);
  const pcmPendingRef = useRef<Float32Array[]>([]);
  const pcmFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingStreamRef = useRef(false);
  const onUpdateRef = useRef(onTranscriptUpdate);
  const onSessionEndRef = useRef(onSessionEnd);
  const onErrorRef = useRef(onError);
  const retainSessionWhenDisabledRef = useRef(retainSessionWhenDisabled);
  onUpdateRef.current = onTranscriptUpdate;
  onSessionEndRef.current = onSessionEnd;
  onErrorRef.current = onError;
  retainSessionWhenDisabledRef.current = retainSessionWhenDisabled;

  const webSupported = useMemo(() => isSpeechRecognitionSupported(), []);

  const resolveEngine = useCallback(async (): Promise<ComposerSpeechEngine | null> => {
    const sherpaReady = await isComposerSherpaSpeechPreferred();
    return resolveComposerSpeechEngine({
      preference: speechEngineMode,
      sherpaReady,
      webSupported,
    });
  }, [speechEngineMode, webSupported]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await resolveEngine();
      if (cancelled) return;
      setEngine(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveEngine]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listenComposerSherpaModelsStatus((payload) => {
      if (payload.phase !== "ready" || !payload.modelsInstalled) return;
      resetComposerSherpaSpeechCacheForTests();
      void resolveEngine().then((next) => setEngine(next));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [resolveEngine]);

  const supported = engine != null;

  const clearPcmFlushTimer = useCallback(() => {
    if (pcmFlushTimerRef.current != null) {
      clearTimeout(pcmFlushTimerRef.current);
      pcmFlushTimerRef.current = null;
    }
  }, []);

  const flushPcmPending = useCallback(() => {
    const sessionId = streamSessionIdRef.current;
    const pending = pcmPendingRef.current;
    pcmPendingRef.current = [];
    if (!sessionId || pending.length === 0) return;
    const merged = mergeFloat32Chunks(pending);
    const targetRate = targetSampleRateRef.current;
    const captureRate = captureSampleRateRef.current;
    const pcm =
      captureRate > 0 && targetRate > 0 && captureRate !== targetRate
        ? resampleFloat32Linear(merged, captureRate, targetRate)
        : merged;
    void appendComposerSherpaStreamingSpeechPcm(sessionId, float32ToBase64(pcm)).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "推送音频失败");
    });
  }, []);

  const schedulePcmFlush = useCallback(() => {
    if (pcmFlushTimerRef.current != null) return;
    pcmFlushTimerRef.current = setTimeout(() => {
      pcmFlushTimerRef.current = null;
      flushPcmPending();
    }, PCM_FLUSH_MS);
  }, [flushPcmPending]);

  const stopWebRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    try {
      rec?.abort();
    } catch {
      try {
        rec?.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const cancelStreamingCapture = useCallback(() => {
    clearPcmFlushTimer();
    pcmPendingRef.current = [];
    finishingStreamRef.current = false;
    const sessionId = streamSessionIdRef.current;
    streamSessionIdRef.current = null;
    if (sessionId) {
      void cancelComposerSherpaStreamingSpeech(sessionId).catch(() => undefined);
    }
    recorderRef.current?.stopStreaming();
    recorderRef.current = null;
  }, [clearPcmFlushTimer]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setListening(false);
    setTranscribing(false);
    stopWebRecognition();
    cancelStreamingCapture();
  }, [cancelStreamingCapture, stopWebRecognition]);

  const beginWebRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      const { text, isFinal } = collectLiveSpeechTranscript(event);
      if (text) onUpdateRef.current({ text, isFinal });
    };
    recognition.onerror = (event) => {
      const msg = speechRecognitionErrorMessage(event.error);
      if (msg) onErrorRef.current?.(msg);
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        wantListeningRef.current = false;
        void openComposerMicrophonePrivacySettings();
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (!wantListeningRef.current) {
        setListening(false);
        onSessionEndRef.current?.();
        return;
      }
      if (!enabled) {
        wantListeningRef.current = false;
        setListening(false);
        onSessionEndRef.current?.();
        return;
      }
      try {
        recognition.start();
      } catch {
        wantListeningRef.current = false;
        setListening(false);
        onSessionEndRef.current?.();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      wantListeningRef.current = false;
      recognitionRef.current = null;
      setListening(false);
      onErrorRef.current?.("无法启动语音听写，请稍后重试。");
    }
  }, [enabled, lang]);

  const isStreamingCaptureActive = useCallback(
    () =>
      wantListeningRef.current ||
      listeningRef.current ||
      Boolean(streamSessionIdRef.current) ||
      recorderRef.current?.recording === true,
    [],
  );

  const finishStreamingCapture = useCallback(async () => {
    setListening(false);

    clearPcmFlushTimer();
    flushPcmPending();
    recorderRef.current?.stopStreaming();
    recorderRef.current = null;

    const sessionId = streamSessionIdRef.current;
    if (!sessionId) {
      cancelStreamingCapture();
      return;
    }

    if (finishingStreamRef.current || transcribingRef.current) {
      return;
    }

    setTranscribing(true);
    finishingStreamRef.current = true;
    try {
      await finishComposerSherpaStreamingSpeech(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "结束语音转写失败");
      finishingStreamRef.current = false;
      streamSessionIdRef.current = null;
      setTranscribing(false);
      setListening(false);
      onSessionEndRef.current?.();
    }
  }, [cancelStreamingCapture, clearPcmFlushTimer, flushPcmPending]);

  const startStreamingCapture = useCallback(async () => {
    if (!wantListeningRef.current) return;

    const recorder = new ComposerAudioRecorder();
    recorderRef.current = recorder;
    try {
      const { sessionId, sampleRate } = await startComposerSherpaStreamingSpeech(
        senseVoiceLangToInvokeArg(senseVoiceLang),
      );
      if (!wantListeningRef.current) {
        void cancelComposerSherpaStreamingSpeech(sessionId).catch(() => undefined);
        cancelStreamingCapture();
        return;
      }

      streamSessionIdRef.current = sessionId;
      targetSampleRateRef.current = sampleRate;
      await recorder.startStreaming({
        sampleRate,
        onPcmChunk: (chunk, captureRate) => {
          if (!streamSessionIdRef.current) return;
          if (captureRate > 0) {
            captureSampleRateRef.current = captureRate;
          }
          pcmPendingRef.current.push(chunk);
          schedulePcmFlush();
        },
      });

      if (!wantListeningRef.current) {
        if (finishingStreamRef.current || transcribingRef.current) {
          return;
        }
        if (streamSessionIdRef.current) {
          void finishStreamingCapture();
        } else {
          cancelStreamingCapture();
        }
        return;
      }

      captureSampleRateRef.current = recorder.getSampleRate();
      setListening(true);
    } catch (e) {
      cancelStreamingCapture();
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "无法开始 SenseVoice 听写");
      wantListeningRef.current = false;
      setListening(false);
    }
  }, [cancelStreamingCapture, finishStreamingCapture, schedulePcmFlush, senseVoiceLang]);

  const start = useCallback(async () => {
    if (!enabled || !supported || !engine) return;
    if (wantListeningRef.current || recognitionRef.current || transcribingRef.current) return;

    const mic = await ensureComposerMicrophoneAccess();
    if (!mic.ok) {
      onErrorRef.current?.(mic.message);
      if (mic.reason === "denied") {
        void openComposerMicrophonePrivacySettings();
      }
      return;
    }
    if (!enabled || !supported || !engine) return;
    if (wantListeningRef.current || recognitionRef.current || transcribingRef.current) return;

    stop();
    wantListeningRef.current = true;

    if (engine === "sensevoice") {
      await startStreamingCapture();
      return;
    }

    beginWebRecognition();
  }, [beginWebRecognition, enabled, engine, startStreamingCapture, stop, supported]);

  const toggle = useCallback(() => {
    if (transcribingRef.current) return;

    if (engine === "sensevoice") {
      if (isStreamingCaptureActive()) {
        wantListeningRef.current = false;
        void finishStreamingCapture();
        return;
      }
      void start();
      return;
    }

    if (listeningRef.current || wantListeningRef.current) {
      stop();
      onSessionEndRef.current?.();
      return;
    }
    void start();
  }, [engine, finishStreamingCapture, isStreamingCaptureActive, start, stop]);

  /** 流式转写事件：Tauri 内挂载即订阅，避免 engine 判定完成前首次听写丢事件。 */
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listenComposerSpeechTranscript(({ sessionId, transcript, isFinal, error }) => {
      if (sessionId !== streamSessionIdRef.current) return;
      if (error?.trim()) {
        onErrorRef.current?.(error.trim());
        if (isFinal) {
          finishingStreamRef.current = false;
          streamSessionIdRef.current = null;
          setTranscribing(false);
          setListening(false);
          wantListeningRef.current = false;
          onSessionEndRef.current?.();
        }
        return;
      }
      if (transcript) {
        onUpdateRef.current({ text: transcript, isFinal });
      }
      if (!isFinal) return;
      if (!finishingStreamRef.current) return;
      finishingStreamRef.current = false;
      streamSessionIdRef.current = null;
      setTranscribing(false);
      setListening(false);
      wantListeningRef.current = false;
      onSessionEndRef.current?.();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (enabled) return;
    if (retainSessionWhenDisabledRef.current?.()) return;
    if (listening || wantListeningRef.current || transcribing) {
      stop();
    }
  }, [enabled, listening, stop, transcribing]);

  useEffect(() => () => stop(), [stop]);

  return {
    supported,
    engine,
    listening,
    transcribing,
    start,
    stop,
    toggle,
  };
}
