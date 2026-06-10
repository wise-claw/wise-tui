import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ComposerSpeechTranscriptPayload } from "../constants/composerSpeech";

/** Tauri 事件：SenseVoice 模型下载进度。 */
export const COMPOSER_SHERPA_MODELS_STATUS_EVENT = "composer-sherpa-models-status" as const;

export interface ComposerSherpaSpeechCapabilities {
  modelsInstalled: boolean;
  modelDir: string;
  ready: boolean;
  downloading: boolean;
  activeProvider?: string | null;
  modelVariant?: string;
}

export interface ComposerSherpaModelsStatusPayload {
  phase: "downloading" | "ready" | "error" | "cancelled";
  message: string;
  modelsInstalled: boolean;
  progressPercent?: number;
}

export interface ComposerStreamingSpeechStart {
  sessionId: string;
  sampleRate: number;
}

let cachedCapabilities: ComposerSherpaSpeechCapabilities | null | undefined;

export function resetComposerSherpaSpeechCacheForTests(): void {
  cachedCapabilities = undefined;
}

export function isComposerSherpaSpeechPlatform(): boolean {
  return isTauri();
}

export async function getComposerSherpaSpeechCapabilities(options?: {
  forceRefresh?: boolean;
}): Promise<ComposerSherpaSpeechCapabilities | null> {
  if (!isComposerSherpaSpeechPlatform()) return null;
  if (!options?.forceRefresh && cachedCapabilities !== undefined) {
    return cachedCapabilities;
  }
  try {
    const caps = await invoke<ComposerSherpaSpeechCapabilities>(
      "composer_sherpa_speech_capabilities",
    );
    cachedCapabilities = caps;
    return caps;
  } catch {
    cachedCapabilities = null;
    return null;
  }
}

export async function isComposerSherpaSpeechPreferred(): Promise<boolean> {
  const caps = await getComposerSherpaSpeechCapabilities();
  return caps?.ready === true;
}

export async function downloadComposerSherpaModels(): Promise<void> {
  if (!isComposerSherpaSpeechPlatform()) return;
  await invoke("composer_sherpa_download_models");
}

export async function cancelComposerSherpaDownloadModels(): Promise<void> {
  if (!isComposerSherpaSpeechPlatform()) return;
  await invoke("composer_sherpa_cancel_download_models");
}

export async function startComposerSherpaStreamingSpeech(
  lang = "auto",
): Promise<ComposerStreamingSpeechStart> {
  return invoke<ComposerStreamingSpeechStart>("composer_sherpa_speech_start", { lang });
}

export async function appendComposerSherpaStreamingSpeechPcm(
  sessionId: string,
  pcmBase64: string,
): Promise<void> {
  await invoke("composer_sherpa_speech_append_pcm", { sessionId, pcmBase64 });
}

export async function finishComposerSherpaStreamingSpeech(sessionId: string): Promise<void> {
  await invoke("composer_sherpa_speech_finish", { sessionId });
}

export async function cancelComposerSherpaStreamingSpeech(sessionId: string): Promise<void> {
  await invoke("composer_sherpa_speech_cancel", { sessionId });
}

export async function listenComposerSherpaModelsStatus(
  handler: (payload: ComposerSherpaModelsStatusPayload) => void,
): Promise<UnlistenFn> {
  return listen<ComposerSherpaModelsStatusPayload>(COMPOSER_SHERPA_MODELS_STATUS_EVENT, (event) => {
    handler(event.payload);
  });
}

export { listenComposerSpeechTranscript } from "./composerLocalSpeech";
export type { ComposerSpeechTranscriptPayload };
