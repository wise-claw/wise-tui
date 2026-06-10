/** 语音听写：转写增量解析 → 口播命令 → 写入/整理 的纯函数流水线。 */

import type { ComposerSpeechEngine } from "../constants/composerSpeech";
import type { ComposerSpeechPreferencesV1 } from "../constants/composerSpeechPreferences";
import { splitUtteranceAtAutoSendEnding } from "./composerSpeechAutoSendEnding";
import {
  buildComposerSpeechVoiceCommands,
  type ComposerSpeechVoiceCommandAction,
  splitUtteranceAtVoiceCommand,
} from "./composerSpeechVoiceCommands";
import { resolveComposerSpeechTranscriptDelta } from "./composerSpeechStreaming";

export type ComposerSpeechTranscriptPipelineAction =
  | { type: "noop" }
  | { type: "clear" }
  | { type: "cancel" }
  | { type: "apply"; spokenText: string; shouldAutoSend: boolean; useLlmPolish: boolean };

export interface ProcessComposerSpeechTranscriptInput {
  engine: ComposerSpeechEngine | null;
  baseline: string;
  lastSentPlain: string;
  rawTranscript: string;
  isFinal: boolean;
  speechPrefs: Pick<
    ComposerSpeechPreferencesV1,
    | "voiceCommandsEnabled"
    | "autoSendEndingText"
    | "voiceCommandClearText"
    | "voiceCommandCancelText"
    | "sendMode"
    | "speechPolishEnabled"
  >;
}

interface ResolvedVoiceCommand {
  spokenText: string;
  shouldAutoSend: boolean;
  voiceAction: ComposerSpeechVoiceCommandAction | null;
}

function resolveVoiceCommand(
  utterance: string,
  prefs: ProcessComposerSpeechTranscriptInput["speechPrefs"],
): ResolvedVoiceCommand {
  if (prefs.voiceCommandsEnabled) {
    const commands = buildComposerSpeechVoiceCommands(prefs);
    const split = splitUtteranceAtVoiceCommand(utterance, commands);
    return {
      spokenText: split.utterance,
      shouldAutoSend: split.action === "send",
      voiceAction: split.action,
    };
  }
  if (prefs.sendMode === "endingWordAutoSend") {
    const split = splitUtteranceAtAutoSendEnding(utterance, prefs.autoSendEndingText);
    return {
      spokenText: split.utterance,
      shouldAutoSend: split.shouldAutoSend,
      voiceAction: null,
    };
  }
  return { spokenText: utterance, shouldAutoSend: false, voiceAction: null };
}

function resolveSpeechVoiceCommand(
  delta: string,
  rawTranscriptFallback: string | undefined,
  prefs: ProcessComposerSpeechTranscriptInput["speechPrefs"],
): ResolvedVoiceCommand {
  const primary = resolveVoiceCommand(delta, prefs);
  if (primary.voiceAction || !rawTranscriptFallback?.trim()) {
    return primary;
  }
  const fallback = resolveVoiceCommand(rawTranscriptFallback, prefs);
  if (
    fallback.voiceAction === "clear" ||
    fallback.voiceAction === "cancel" ||
    (fallback.voiceAction === "send" && fallback.shouldAutoSend)
  ) {
    return fallback;
  }
  return primary;
}

const SPEECH_FILLER_FOR_LLM =
  /(?:嗯|啊|呃|额|诶|那个|就是|然后|就是说|怎么说呢|这样的话)/u;

/** 短句或已足够清晰时跳过 LLM 整理，降低听写延迟。 */
export function shouldUseLlmSpeechPolish(rawTranscript: string): boolean {
  const text = rawTranscript.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (SPEECH_FILLER_FOR_LLM.test(text)) return true;
  return text.length > 20;
}

/** 解析单次转写更新应执行的动作（不含副作用）。 */
export function processComposerSpeechTranscriptUpdate(
  input: ProcessComposerSpeechTranscriptInput,
): ComposerSpeechTranscriptPipelineAction {
  const delta = resolveComposerSpeechTranscriptDelta({
    engine: input.engine,
    baseline: input.baseline,
    rawTranscript: input.rawTranscript,
    lastSentPlain: input.lastSentPlain,
  });

  const { spokenText, shouldAutoSend, voiceAction } = resolveSpeechVoiceCommand(
    delta,
    input.isFinal ? input.rawTranscript : undefined,
    input.speechPrefs,
  );

  if (voiceAction === "clear") return { type: "clear" };
  if (voiceAction === "cancel") return { type: "cancel" };
  if (!spokenText.trim() && !shouldAutoSend) return { type: "noop" };

  const useLlmPolish =
    input.speechPrefs.speechPolishEnabled &&
    shouldUseLlmSpeechPolish(spokenText) &&
    !shouldAutoSend;

  // 仅「需要 LLM 整理」且非口播发送时等待 final；清晰短句与结束词发送走本地整理，减少等 ASR 收尾延迟。
  if (input.speechPrefs.speechPolishEnabled && !input.isFinal) {
    if (useLlmPolish && !shouldAutoSend) {
      return { type: "noop" };
    }
  }

  return {
    type: "apply",
    spokenText,
    shouldAutoSend,
    useLlmPolish,
  };
}
