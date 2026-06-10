/** 语音听写：口播命令检测（清除 / 发送 / 取消任务等，不写入输入框正文）。 */

import type { ComposerSpeechPreferencesV1 } from "../constants/composerSpeechPreferences";
import { normalizeComposerSpeechAutoSendEndingText } from "./composerSpeechAutoSendEnding";

export type ComposerSpeechVoiceCommandAction = "send" | "clear" | "cancel";

export interface ComposerSpeechVoiceCommandRule {
  action: ComposerSpeechVoiceCommandAction;
  phrases: string[];
}

function normalizeVoiceCommandPhrase(raw: string): string {
  return normalizeComposerSpeechAutoSendEndingText(raw);
}

function uniqueNonEmptyPhrases(phrases: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of phrases) {
    const phrase = normalizeVoiceCommandPhrase(raw);
    if (!phrase || seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
  }
  return out;
}

/** 根据偏好构建口播命令表（短语按长度降序匹配，避免短词误触）。 */
export function buildComposerSpeechVoiceCommands(
  prefs: Pick<
    ComposerSpeechPreferencesV1,
    | "voiceCommandsEnabled"
    | "autoSendEndingText"
    | "voiceCommandClearText"
    | "voiceCommandCancelText"
  >,
): ComposerSpeechVoiceCommandRule[] {
  if (!prefs.voiceCommandsEnabled) return [];

  const sendPhrase = normalizeVoiceCommandPhrase(prefs.autoSendEndingText);
  const clearPhrase = normalizeVoiceCommandPhrase(prefs.voiceCommandClearText);
  const cancelPhrase = normalizeVoiceCommandPhrase(prefs.voiceCommandCancelText);

  const rules: ComposerSpeechVoiceCommandRule[] = [];

  if (cancelPhrase) {
    rules.push({
      action: "cancel",
      phrases: uniqueNonEmptyPhrases([
        cancelPhrase,
        "取消任务",
        "取消上一个任务",
        "停止执行",
      ]),
    });
  }

  if (clearPhrase) {
    rules.push({
      action: "clear",
      phrases: uniqueNonEmptyPhrases([clearPhrase, "清空", "清除输入", "清空输入"]),
    });
  }

  if (sendPhrase) {
    rules.push({
      action: "send",
      phrases: [sendPhrase],
    });
  }

  return rules;
}

function normalizeVoiceCommandUtterance(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[，。！？、,.!?;:：；…]+$/u, "");
}

export function splitUtteranceAtVoiceCommand(
  utterance: string,
  commands: ComposerSpeechVoiceCommandRule[],
): { utterance: string; action: ComposerSpeechVoiceCommandAction | null } {
  if (!commands.length) {
    return { utterance, action: null };
  }

  const normalized = normalizeVoiceCommandUtterance(utterance);
  if (!normalized) {
    return { utterance, action: null };
  }

  const flat = commands
    .flatMap((rule) => rule.phrases.map((phrase) => ({ action: rule.action, phrase })))
    .sort((a, b) => b.phrase.length - a.phrase.length);

  for (const { action, phrase } of flat) {
    if (normalized === phrase) {
      return { utterance: "", action };
    }
    if (normalized.endsWith(phrase)) {
      const stripped = normalizeVoiceCommandUtterance(
        normalized.slice(0, normalized.length - phrase.length),
      );
      return { utterance: stripped, action };
    }
  }

  return { utterance, action: null };
}
