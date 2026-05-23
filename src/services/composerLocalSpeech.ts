import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isMacLikePlatform } from "../components/GitPanel/explorerUtils";
import {
  COMPOSER_SPEECH_TRANSCRIPT_EVENT,
  type ComposerSpeechTranscriptPayload,
} from "../constants/composerSpeech";
import { macosOpenPrivacyPane } from "./cuaDriver";

export interface MacosLocalSpeechCapabilities {
  available: boolean;
  onDevice: boolean;
  authorization: "authorized" | "denied" | "restricted" | "not_determined";
}

let cachedCapabilities: MacosLocalSpeechCapabilities | null | undefined;

export function resetComposerLocalSpeechCacheForTests(): void {
  cachedCapabilities = undefined;
}

export function isComposerLocalSpeechPlatform(): boolean {
  return isTauri() && isMacLikePlatform();
}

export async function getComposerLocalSpeechCapabilities(
  lang = "zh-CN",
  options?: { forceRefresh?: boolean },
): Promise<MacosLocalSpeechCapabilities | null> {
  if (!isComposerLocalSpeechPlatform()) return null;
  if (!options?.forceRefresh && cachedCapabilities !== undefined) {
    return cachedCapabilities;
  }
  try {
    const caps = await invoke<MacosLocalSpeechCapabilities>("macos_local_speech_capabilities", { lang });
    cachedCapabilities = caps;
    return caps;
  } catch {
    cachedCapabilities = null;
    return null;
  }
}

export async function isComposerLocalSpeechPreferred(lang = "zh-CN"): Promise<boolean> {
  const caps = await getComposerLocalSpeechCapabilities(lang);
  return caps?.available === true;
}

export interface ComposerStreamingSpeechStart {
  sessionId: string;
  sampleRate: number;
}

export async function startComposerStreamingSpeech(
  lang = "zh-CN",
): Promise<ComposerStreamingSpeechStart> {
  return invoke<ComposerStreamingSpeechStart>("macos_streaming_speech_start", { lang });
}

export async function appendComposerStreamingSpeechPcm(
  sessionId: string,
  pcmBase64: string,
): Promise<void> {
  await invoke("macos_streaming_speech_append_pcm", { sessionId, pcmBase64 });
}

export async function finishComposerStreamingSpeech(sessionId: string): Promise<void> {
  await invoke("macos_streaming_speech_finish", { sessionId });
}

export async function cancelComposerStreamingSpeech(sessionId: string): Promise<void> {
  await invoke("macos_streaming_speech_cancel", { sessionId });
}

export async function listenComposerSpeechTranscript(
  handler: (payload: ComposerSpeechTranscriptPayload) => void,
): Promise<UnlistenFn> {
  return listen<ComposerSpeechTranscriptPayload>(COMPOSER_SPEECH_TRANSCRIPT_EVENT, (event) => {
    handler(event.payload);
  });
}

export async function openComposerSpeechRecognitionPrivacySettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    await macosOpenPrivacyPane("speechRecognition");
  } catch {
    /* 打开失败时静默 */
  }
}
