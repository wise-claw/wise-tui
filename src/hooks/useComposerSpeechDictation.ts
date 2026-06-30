import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureComposerMicrophoneAccess,
  openComposerMicrophonePrivacySettings,
} from "../services/composerMicrophone";
import { listenComposerSpeechTranscript } from "../services/composerLocalSpeech";
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
import type {
  ComposerSpeechEnginePreference,
  SenseVoiceLanguagePreference,
} from "../constants/composerSpeechPreferences";
import { resolveComposerSpeechEngine } from "../utils/composerSpeechEngine";
import { senseVoiceLangToInvokeArg } from "../utils/senseVoiceLang";

export type { ComposerSpeechEngine };

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
  /** 当前段的实时草稿（partial）。新段开始时回调空串。仅用于预览，不应直接入框。 */
  onSegmentInterim: (text: string) => void;
  /** 一整段语音的最终转写（来自该段 ASR 会话的 finish）。 */
  onSegmentFinal: (text: string) => void;
  /** 某段结束后是否自动开启下一段（连续 / 自动发送场景）。 */
  continueAfterSegment?: () => boolean;
  /** 听写整体结束（不再有进行中的段，且不会继续）。 */
  onListeningEnd?: () => void;
  onError?: (message: string) => void;
}

const PCM_FLUSH_MS = 80;

export function useComposerSpeechDictation({
  enabled = true,
  retainSessionWhenDisabled,
  lang = "zh-CN",
  speechEngineMode = "auto",
  senseVoiceLang = "auto",
  onSegmentInterim,
  onSegmentFinal,
  continueAfterSegment,
  onListeningEnd,
  onError,
}: UseComposerSpeechDictationOptions) {
  const [engine, setEngine] = useState<ComposerSpeechEngine | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const engineRef = useRef<ComposerSpeechEngine | null>(null);
  engineRef.current = engine;

  const wantListeningRef = useRef(false);

  // SenseVoice（流式）：录音机贯穿整个听写期，每段是一个独立后端会话。
  const recorderRef = useRef<ComposerAudioRecorder | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const finalizingSessionIdRef = useRef<string | null>(null);
  const continueAfterFinalizeRef = useRef(false);
  const targetSampleRateRef = useRef(16_000);
  const captureSampleRateRef = useRef(16_000);
  const pcmPendingRef = useRef<Float32Array[]>([]);
  const pcmFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web Speech：每段是一个独立 recognition 实例。
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const webSegmentTextRef = useRef("");
  const webContinueRef = useRef(false);

  // 电平采集：两路共用一个 ref，UI 通过 subscribeAudioLevel 订阅（避免组件高频重渲染）。
  // SenseVoice 路径由 ComposerAudioRecorder 直接写；Web Speech 路径由 hook 自己起轻量 AnalyserNode。
  const audioLevelRef = useRef<number>(0);
  const webLevelStreamRef = useRef<MediaStream | null>(null);
  const webLevelContextRef = useRef<AudioContext | null>(null);
  const webLevelAnalyserRef = useRef<AnalyserNode | null>(null);
  const webLevelRafRef = useRef<number | null>(null);

  const lastInterimRef = useRef("");

  const onSegmentInterimRef = useRef(onSegmentInterim);
  const onSegmentFinalRef = useRef(onSegmentFinal);
  const continueAfterSegmentRef = useRef(continueAfterSegment);
  const onListeningEndRef = useRef(onListeningEnd);
  const onErrorRef = useRef(onError);
  const retainSessionWhenDisabledRef = useRef(retainSessionWhenDisabled);
  onSegmentInterimRef.current = onSegmentInterim;
  onSegmentFinalRef.current = onSegmentFinal;
  continueAfterSegmentRef.current = continueAfterSegment;
  onListeningEndRef.current = onListeningEnd;
  onErrorRef.current = onError;
  retainSessionWhenDisabledRef.current = retainSessionWhenDisabled;

  const langRef = useRef(lang);
  langRef.current = lang;
  const senseVoiceLangRef = useRef(senseVoiceLang);
  senseVoiceLangRef.current = senseVoiceLang;

  // ---- 电平订阅 ----
  // 波形组件订阅本 ref 的最新值，避免每帧 setState。
  const audioLevelSinkRef = useRef<((level: number) => void) | null>(null);
  const setAudioLevelSink = useCallback((sink: ((level: number) => void) | null) => {
    audioLevelSinkRef.current = sink;
    if (sink) {
      // 立即推送当前值，避免首帧空白
      sink(audioLevelRef.current);
    }
  }, []);

  const stopWebLevelMeter = useCallback(() => {
    if (webLevelRafRef.current != null) {
      cancelAnimationFrame(webLevelRafRef.current);
      webLevelRafRef.current = null;
    }
    if (webLevelAnalyserRef.current) {
      try {
        webLevelAnalyserRef.current.disconnect();
      } catch {
        /* ignore */
      }
      webLevelAnalyserRef.current = null;
    }
    if (webLevelStreamRef.current) {
      for (const track of webLevelStreamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      webLevelStreamRef.current = null;
    }
    if (webLevelContextRef.current) {
      void webLevelContextRef.current.close().catch(() => undefined);
      webLevelContextRef.current = null;
    }
    audioLevelRef.current = 0;
    audioLevelSinkRef.current?.(0);
  }, []);

  const startWebLevelMeter = useCallback(async () => {
    if (webLevelStreamRef.current) return;
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) return;
    try {
      const stream = await mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      // hook 在 openWebSegment 期间可能要 teardownAll，竞态防护：若此时已不再需要，关闭流。
      if (!wantListeningRef.current || engineRef.current !== "web") {
        for (const track of stream.getTracks()) {
          try {
            track.stop();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      webLevelStreamRef.current = stream;
      const ctx = new Ctx();
      webLevelContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      webLevelAnalyserRef.current = analyser;
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        const analyserRef = webLevelAnalyserRef.current;
        if (!analyserRef) return;
        analyserRef.getFloatTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const v = buf[i] ?? 0;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / buf.length);
        let level = 0;
        if (Number.isFinite(rms) && rms > 0) {
          const scaled = Math.min(1, rms * 6);
          level = scaled < 0.02 ? 0 : scaled;
        }
        audioLevelRef.current = level;
        audioLevelSinkRef.current?.(level);
        webLevelRafRef.current = requestAnimationFrame(tick);
      };
      webLevelRafRef.current = requestAnimationFrame(tick);
    } catch {
      // 麦权限失败/无设备：交给 SpeechRecognition 的 onerror 报
    }
  }, []);

  const emitInterim = useCallback((text: string) => {
    if (text === lastInterimRef.current) return;
    lastInterimRef.current = text;
    onSegmentInterimRef.current(text);
  }, []);

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
    let cancelled = false;
    void listenComposerSherpaModelsStatus((payload) => {
      if (payload.phase !== "ready" || !payload.modelsInstalled) return;
      resetComposerSherpaSpeechCacheForTests();
      void resolveEngine().then((next) => setEngine(next));
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [resolveEngine]);

  const supported = engine != null;

  // ---- PCM 流式辅助（SenseVoice） ----
  const clearPcmFlushTimer = useCallback(() => {
    if (pcmFlushTimerRef.current != null) {
      clearTimeout(pcmFlushTimerRef.current);
      pcmFlushTimerRef.current = null;
    }
  }, []);

  const flushPcmTo = useCallback((sessionId: string | null) => {
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
      flushPcmTo(currentSessionIdRef.current);
    }, PCM_FLUSH_MS);
  }, [flushPcmTo]);

  const teardownSenseVoiceRecorder = useCallback(() => {
    clearPcmFlushTimer();
    pcmPendingRef.current = [];
    recorderRef.current?.stopStreaming();
    recorderRef.current = null;
  }, [clearPcmFlushTimer]);

  const stopWebRecognition = useCallback((abort: boolean) => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (abort) {
      recognitionRef.current = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      // abort 不会触发 onend，必须显式关 meter
      stopWebLevelMeter();
    } else {
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        stopWebLevelMeter();
      }
    }
  }, [stopWebLevelMeter]);

  /** 彻底停止并丢弃所有进行中的捕获状态（不发 final）。 */
  const teardownAll = useCallback(() => {
    wantListeningRef.current = false;
    continueAfterFinalizeRef.current = false;
    webContinueRef.current = false;

    const active = currentSessionIdRef.current;
    const finalizing = finalizingSessionIdRef.current;
    currentSessionIdRef.current = null;
    finalizingSessionIdRef.current = null;
    if (active) void cancelComposerSherpaStreamingSpeech(active).catch(() => undefined);
    if (finalizing) void cancelComposerSherpaStreamingSpeech(finalizing).catch(() => undefined);
    teardownSenseVoiceRecorder();
    stopWebRecognition(true);
    stopWebLevelMeter();
    webSegmentTextRef.current = "";
    lastInterimRef.current = "";
    setListening(false);
    setTranscribing(false);
  }, [stopWebLevelMeter, stopWebRecognition, teardownSenseVoiceRecorder]);

  // ---- SenseVoice 段生命周期 ----
  const openSenseVoiceSegment = useCallback(async () => {
    if (!wantListeningRef.current) return;
    try {
      const { sessionId, sampleRate } = await startComposerSherpaStreamingSpeech(
        senseVoiceLangToInvokeArg(senseVoiceLangRef.current),
      );
      if (!wantListeningRef.current) {
        void cancelComposerSherpaStreamingSpeech(sessionId).catch(() => undefined);
        teardownSenseVoiceRecorder();
        return;
      }
      currentSessionIdRef.current = sessionId;
      targetSampleRateRef.current = sampleRate;
      lastInterimRef.current = "";
      emitInterim("");

      if (!recorderRef.current) {
        const recorder = new ComposerAudioRecorder();
        recorderRef.current = recorder;
        await recorder.startStreaming({
          sampleRate,
          onPcmChunk: (chunk, captureRate) => {
            if (!currentSessionIdRef.current) return; // finalize 间隙丢弃
            if (captureRate > 0) captureSampleRateRef.current = captureRate;
            pcmPendingRef.current.push(chunk);
            schedulePcmFlush();
          },
          onAudioLevel: (level) => {
            audioLevelRef.current = level;
            audioLevelSinkRef.current?.(level);
          },
        });
        // getUserMedia 期间可能已被 teardown（会话切换 / 取消 / 卸载）：teardown 在 stream 尚为 null 时
        // 清理过 recorderRef 并置空。此刻本地 recorder 刚拿到真实麦克风轨道却已无引用，必须显式停止，
        // 否则麦克风泄漏（系统录音指示常亮，直到刷新）。
        if (!wantListeningRef.current || recorderRef.current !== recorder) {
          recorder.stopStreaming();
          if (recorderRef.current === recorder) recorderRef.current = null;
          teardownAll();
          return;
        }
        captureSampleRateRef.current = recorder.getSampleRate();
      }
      setTranscribing(false);
      setListening(true);
    } catch (e) {
      teardownAll();
      const msg = e instanceof Error ? e.message : String(e);
      onErrorRef.current?.(msg || "无法开始 SenseVoice 听写");
    }
  }, [emitInterim, schedulePcmFlush, teardownAll, teardownSenseVoiceRecorder]);

  const handleSenseVoiceFinalArrived = useCallback(
    (sessionId: string, transcript: string) => {
      if (sessionId === finalizingSessionIdRef.current) finalizingSessionIdRef.current = null;
      if (sessionId === currentSessionIdRef.current) currentSessionIdRef.current = null;
      const cont = continueAfterFinalizeRef.current;
      continueAfterFinalizeRef.current = false;
      setTranscribing(false);
      lastInterimRef.current = "";

      onSegmentFinalRef.current(transcript.trim());

      if (cont && wantListeningRef.current && enabledRef.current) {
        void openSenseVoiceSegment();
      } else if (!currentSessionIdRef.current) {
        // 仅当没有新段在进行时才拆除（防御 transcribing 期间又 start() 的竞态，避免误拆新段录音机）。
        teardownSenseVoiceRecorder();
        wantListeningRef.current = false;
        setListening(false);
        onListeningEndRef.current?.();
      }
    },
    [openSenseVoiceSegment, teardownSenseVoiceRecorder],
  );

  const finalizeSenseVoiceSegment = useCallback(
    (continueListening: boolean) => {
      const sid = currentSessionIdRef.current;
      if (!sid) {
        if (!continueListening && !finalizingSessionIdRef.current) {
          teardownSenseVoiceRecorder();
          if (listening) setListening(false);
        }
        return;
      }
      currentSessionIdRef.current = null;
      finalizingSessionIdRef.current = sid;
      continueAfterFinalizeRef.current = continueListening;
      setTranscribing(true);
      clearPcmFlushTimer();
      flushPcmTo(sid);
      void finishComposerSherpaStreamingSpeech(sid).catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        onErrorRef.current?.(msg || "结束语音转写失败");
        // finish 失败：以空 final 兜底，避免卡在 transcribing。
        handleSenseVoiceFinalArrived(sid, "");
      });
    },
    [clearPcmFlushTimer, flushPcmTo, handleSenseVoiceFinalArrived, listening, teardownSenseVoiceRecorder],
  );

  // ---- Web Speech 段生命周期 ----
  const openWebSegment = useCallback(() => {
    if (!wantListeningRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = langRef.current;
    webSegmentTextRef.current = "";
    lastInterimRef.current = "";

    recognition.onstart = () => {
      emitInterim("");
      setTranscribing(false);
      setListening(true);
      void startWebLevelMeter();
    };
    recognition.onresult = (event) => {
      const { text } = collectLiveSpeechTranscript(event);
      webSegmentTextRef.current = text;
      emitInterim(text);
    };
    recognition.onerror = (event) => {
      const msg = speechRecognitionErrorMessage(event.error);
      if (msg) onErrorRef.current?.(msg);
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture" ||
        event.error === "network"
      ) {
        wantListeningRef.current = false;
        webContinueRef.current = false;
        stopWebLevelMeter();
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          void openComposerMicrophonePrivacySettings();
        }
      }
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      const finalText = webSegmentTextRef.current;
      webSegmentTextRef.current = "";
      const cont = webContinueRef.current;
      webContinueRef.current = false;
      setTranscribing(false);
      lastInterimRef.current = "";
      onSegmentFinalRef.current(finalText.trim());
      if (cont && wantListeningRef.current && enabledRef.current) {
        openWebSegment();
      } else {
        wantListeningRef.current = false;
        setListening(false);
        stopWebLevelMeter();
        onListeningEndRef.current?.();
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      wantListeningRef.current = false;
      setListening(false);
      onErrorRef.current?.("无法启动语音听写，请稍后重试。");
    }
  }, [emitInterim]);

  const finalizeWebSegment = useCallback(
    (continueListening: boolean) => {
      webContinueRef.current = continueListening;
      const rec = recognitionRef.current;
      if (!rec) {
        if (!continueListening) {
          setListening(false);
          onListeningEndRef.current?.();
        }
        return;
      }
      setTranscribing(true);
      try {
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    },
    [],
  );

  // ---- 对外动作 ----
  const start = useCallback(async () => {
    if (!enabledRef.current || !supported || !engine) return;
    if (wantListeningRef.current) return;

    const mic = await ensureComposerMicrophoneAccess();
    if (!mic.ok) {
      onErrorRef.current?.(mic.message);
      if (mic.reason === "denied") {
        void openComposerMicrophonePrivacySettings();
      }
      return;
    }
    if (!enabledRef.current || !supported || !engine) return;
    if (wantListeningRef.current) return;

    wantListeningRef.current = true;
    lastInterimRef.current = "";
    if (engine === "sensevoice") {
      await openSenseVoiceSegment();
    } else {
      openWebSegment();
    }
  }, [engine, openSenseVoiceSegment, openWebSegment, supported]);

  /** 结束当前段；按引擎判定是否续段（连续 / 自动发送）。 */
  const finalizeSegment = useCallback(
    (opts?: { continueListening?: boolean }) => {
      const cont = opts?.continueListening ?? continueAfterSegmentRef.current?.() ?? false;
      if (engineRef.current === "sensevoice") {
        finalizeSenseVoiceSegment(cont);
      } else {
        finalizeWebSegment(cont);
      }
    },
    [finalizeSenseVoiceSegment, finalizeWebSegment],
  );

  /** 手动停止：结束当前段并捕获其文本，不再续段。 */
  const stop = useCallback(() => {
    wantListeningRef.current = false;
    if (engineRef.current === "sensevoice") {
      if (currentSessionIdRef.current) {
        finalizeSenseVoiceSegment(false);
      } else if (!finalizingSessionIdRef.current) {
        teardownSenseVoiceRecorder();
        setListening(false);
      }
    } else {
      finalizeWebSegment(false);
    }
  }, [finalizeSenseVoiceSegment, finalizeWebSegment, teardownSenseVoiceRecorder]);

  /** 丢弃当前听写，不产出 final。 */
  const cancel = useCallback(() => {
    teardownAll();
  }, [teardownAll]);

  const toggle = useCallback(() => {
    if (transcribing) return;
    if (wantListeningRef.current || listening) {
      stop();
      return;
    }
    void start();
  }, [listening, start, stop, transcribing]);

  // 流式转写事件：挂载即订阅，避免 engine 判定完成前首次听写丢事件。
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenComposerSpeechTranscript(({ sessionId, transcript, isFinal, error }) => {
      const isCurrent = sessionId === currentSessionIdRef.current;
      const isFinalizing = sessionId === finalizingSessionIdRef.current;
      if (!isCurrent && !isFinalizing) return;

      if (error?.trim()) {
        onErrorRef.current?.(error.trim());
        if (isFinal) {
          handleSenseVoiceFinalArrived(sessionId, transcript ?? "");
        }
        return;
      }

      if (isFinal) {
        handleSenseVoiceFinalArrived(sessionId, transcript ?? "");
        return;
      }
      if (isCurrent && transcript) {
        emitInterim(transcript);
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [emitInterim, handleSenseVoiceFinalArrived]);

  // enabled → false：除非显式 retain，否则停止（连续录音 + 自动发送可保活）。
  useEffect(() => {
    if (enabled) return;
    if (retainSessionWhenDisabledRef.current?.()) return;
    if (wantListeningRef.current || listening || transcribing) {
      stop();
    }
  }, [enabled, listening, stop, transcribing]);

  useEffect(() => () => teardownAll(), [teardownAll]);

  return {
    supported,
    engine,
    listening,
    transcribing,
    start,
    stop,
    cancel,
    toggle,
    finalizeSegment,
    /**
     * 订阅/取消订阅实时电平（0..1）。
     * 回调以 ref.current 形式被调用方缓存，组件无需高频重渲染；
     * meter 通过本接口注册，并在卸载时传 null 解除。
     */
    setAudioLevelSink,
  };
}
