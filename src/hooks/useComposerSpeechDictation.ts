import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensureComposerMicrophoneAccess,
  openComposerMicrophonePrivacySettings,
} from "../services/composerMicrophone";
import {
  collectFinalSpeechTranscript,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  speechRecognitionErrorMessage,
  type SpeechRecognitionLike,
} from "../utils/composerSpeechRecognition";

export interface UseComposerSpeechDictationOptions {
  /** 为 false 时不启动识别（例如会话占用中）。 */
  enabled?: boolean;
  /** BCP-47 语言，默认 zh-CN。 */
  lang?: string;
  onFinalTranscript: (text: string) => void;
  onError?: (message: string) => void;
}

export function useComposerSpeechDictation({
  enabled = true,
  lang = "zh-CN",
  onFinalTranscript,
  onError,
}: UseComposerSpeechDictationOptions) {
  const supported = useMemo(() => isSpeechRecognitionSupported(), []);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantListeningRef = useRef(false);
  const onFinalRef = useRef(onFinalTranscript);
  const onErrorRef = useRef(onError);
  onFinalRef.current = onFinalTranscript;
  onErrorRef.current = onError;

  const stop = useCallback(() => {
    wantListeningRef.current = false;
    setListening(false);
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

  const beginRecognition = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      const transcript = collectFinalSpeechTranscript(event).trim();
      if (transcript) onFinalRef.current(transcript);
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
        return;
      }
      if (!enabled) {
        wantListeningRef.current = false;
        setListening(false);
        return;
      }
      try {
        recognition.start();
      } catch {
        wantListeningRef.current = false;
        setListening(false);
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
  }, [lang]);

  const start = useCallback(async () => {
    if (!enabled || !supported) return;
    if (wantListeningRef.current || recognitionRef.current) return;

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
    beginRecognition();
  }, [beginRecognition, enabled, stop, supported]);

  const toggle = useCallback(() => {
    if (listening || wantListeningRef.current) {
      stop();
      return;
    }
    void start();
  }, [listening, start, stop]);

  useEffect(() => {
    if (!enabled && (listening || wantListeningRef.current)) {
      stop();
    }
  }, [enabled, listening, stop]);

  useEffect(() => () => stop(), [stop]);

  return {
    supported,
    listening,
    start,
    stop,
    toggle,
  };
}
