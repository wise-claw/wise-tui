import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureComposerMicrophoneAccess,
  openComposerMicrophonePrivacySettings,
} from "../services/composerMicrophone";
import {
  appendComposerStreamingSpeechPcm,
  cancelComposerStreamingSpeech,
  finishComposerStreamingSpeech,
  isComposerLocalSpeechPlatform,
  isComposerLocalSpeechPreferred,
  listenComposerSpeechTranscript,
  openComposerSpeechRecognitionPrivacySettings,
  startComposerStreamingSpeech,
} from "../services/composerLocalSpeech";
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

export type ComposerSpeechEngine = "local" | "web";

export interface ComposerSpeechTranscriptUpdate {
  text: string;
  isFinal: boolean;
}

export interface UseComposerSpeechDictationOptions {
  /** 为 false 时不启动识别（例如会话占用中）。 */
  enabled?: boolean;
  /** BCP-47 语言，默认 zh-CN。 */
  lang?: string;
  /** 流式 partial 或 final 更新（边说边出字）。 */
  onTranscriptUpdate: (update: ComposerSpeechTranscriptUpdate) => void;
  /** 整段听写结束（本地模式在 final 后；Web 模式在 stop 时可选触发）。 */
  onSessionEnd?: () => void;
  onError?: (message: string) => void;
}

const PCM_FLUSH_MS = 120;

export function useComposerSpeechDictation({
  enabled = true,
  lang = "zh-CN",
  onTranscriptUpdate,
  onSessionEnd,
  onError,
}: UseComposerSpeechDictationOptions) {
  const [engine, setEngine] = useState<ComposerSpeechEngine | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const recorderRef = useRef<ComposerAudioRecorder | null>(null);
  const streamSessionIdRef = useRef<string | null>(null);
  const targetSampleRateRef = useRef(16_000);
  const captureSampleRateRef = useRef(16_000);
  const pcmPendingRef = useRef<Float32Array[]>([]);
  const pcmFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onUpdateRef = useRef(onTranscriptUpdate);
  const onSessionEndRef = useRef(onSessionEnd);
  const onErrorRef = useRef(onError);
  onUpdateRef.current = onTranscriptUpdate;
  onSessionEndRef.current = onSessionEnd;
  onErrorRef.current = onError;

  const webSupported = useMemo(() => isSpeechRecognitionSupported(), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await isComposerLocalSpeechPreferred(lang);
      if (cancelled) return;
      if (local) {
        setEngine("local");
        return;
      }
      setEngine(webSupported ? "web" : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [lang, webSupported]);

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
    void appendComposerStreamingSpeechPcm(sessionId, float32ToBase64(pcm)).catch((e) => {
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

  const cancelLocalStream = useCallback(() => {
    clearPcmFlushTimer();
    pcmPendingRef.current = [];
    const sessionId = streamSessionIdRef.current;
    streamSessionIdRef.current = null;
    if (sessionId) {
      void cancelComposerStreamingSpeech(sessionId).catch(() => undefined);
    }
    recorderRef.current?.stopStreaming();
    recorderRef.current = null;
  }, [clearPcmFlushTimer]);

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setListening(false);
    setTranscribing(false);
    stopWebRecognition();
    cancelLocalStream();
  }, [cancelLocalStream, stopWebRecognition]);

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

  const finishLocalStream = useCallback(async () => {
    clearPcmFlushTimer();
    flushPcmPending();
    recorderRef.current?.stopStreaming();
    recorderRef.current = null;

    const sessionId = streamSessionIdRef.current;
    if (!sessionId) {
      setListening(false);
      return;
    }

    setTranscribing(true);
    try {
      await finishComposerStreamingSpeech(sessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "结束语音转写失败");
      streamSessionIdRef.current = null;
      setTranscribing(false);
      setListening(false);
      onSessionEndRef.current?.();
    }
  }, [clearPcmFlushTimer, flushPcmPending]);

  const startLocalStream = useCallback(async () => {
    const recorder = new ComposerAudioRecorder();
    recorderRef.current = recorder;
    try {
      const { sessionId, sampleRate } = await startComposerStreamingSpeech(lang);
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
      captureSampleRateRef.current = recorder.getSampleRate();
      setListening(true);
    } catch (e) {
      cancelLocalStream();
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "无法开始本地语音转写");
      if (msg.includes("语音识别权限")) {
        void openComposerSpeechRecognitionPrivacySettings();
      }
      wantListeningRef.current = false;
      setListening(false);
    }
  }, [cancelLocalStream, lang, schedulePcmFlush]);

  const start = useCallback(async () => {
    if (!enabled || !supported || !engine) return;
    if (wantListeningRef.current || recognitionRef.current || transcribing) return;

    const mic = await ensureComposerMicrophoneAccess();
    if (!mic.ok) {
      onErrorRef.current?.(mic.message);
      if (mic.reason === "denied") {
        void openComposerMicrophonePrivacySettings();
      }
      return;
    }

    stop();
    wantListeningRef.current = true;

    if (engine === "local") {
      await startLocalStream();
      return;
    }

    beginWebRecognition();
  }, [beginWebRecognition, enabled, engine, startLocalStream, stop, supported, transcribing]);

  const toggle = useCallback(() => {
    if (transcribing) return;

    if (engine === "local") {
      if (listening || wantListeningRef.current) {
        wantListeningRef.current = false;
        void finishLocalStream();
        return;
      }
      void start();
      return;
    }

    if (listening || wantListeningRef.current) {
      stop();
      onSessionEndRef.current?.();
      return;
    }
    void start();
  }, [engine, finishLocalStream, listening, start, stop, transcribing]);

  /** macOS 本地转写事件：挂载即订阅，避免 engine 判定完成前首次听写丢事件。 */
  useEffect(() => {
    if (!isComposerLocalSpeechPlatform()) return;
    let unlisten: (() => void) | undefined;
    void listenComposerSpeechTranscript(({ sessionId, transcript, isFinal, error }) => {
      if (sessionId !== streamSessionIdRef.current) return;
      if (error?.trim()) {
        onErrorRef.current?.(error.trim());
      }
      if (transcript) {
        onUpdateRef.current({ text: transcript, isFinal });
      }
      if (!isFinal) return;
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
    if (!enabled && (listening || wantListeningRef.current || transcribing)) {
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
