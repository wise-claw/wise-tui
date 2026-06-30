/** 语音听写：对「一整段」最终转写解析口播命令 / 结束词，决定提交动作（纯函数，无副作用）。
 *
 * 重构要点：每段语音是独立单元（一个 ASR 会话 = 一段），不再做 cumulative 基线相减。
 * 后处理（整理）统一在下游闸口完成，这里只负责剥离命令词并判定 commit / clear / cancel。
 */

import type { ComposerSpeechPreferencesV1 } from "../constants/composerSpeechPreferences";
import { splitUtteranceAtAutoSendEnding } from "./composerSpeechAutoSendEnding";
import {
  buildComposerSpeechVoiceCommands,
  type ComposerSpeechVoiceCommandAction,
  splitUtteranceAtVoiceCommand,
} from "./composerSpeechVoiceCommands";

export type ComposerSpeechSegmentAction =
  | { type: "noop" }
  | { type: "clear" }
  | { type: "cancel" }
  | { type: "commit"; spokenText: string; shouldAutoSend: boolean };

export type ComposerSpeechSegmentPrefs = Pick<
  ComposerSpeechPreferencesV1,
  | "voiceCommandsEnabled"
  | "autoSendEndingText"
  | "voiceCommandClearText"
  | "voiceCommandCancelText"
  | "sendMode"
>;

export interface ResolveComposerSpeechSegmentInput {
  /** 一整段语音的最终转写文本。 */
  segmentText: string;
  speechPrefs: ComposerSpeechSegmentPrefs;
  /** 该段由静音自动发送触发：即使无结束词也强制发送。 */
  forceAutoSend?: boolean;
}

interface ResolvedVoiceCommand {
  spokenText: string;
  shouldAutoSend: boolean;
  voiceAction: ComposerSpeechVoiceCommandAction | null;
}

function resolveVoiceCommand(
  utterance: string,
  prefs: ComposerSpeechSegmentPrefs,
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

/** 解析一整段最终转写应执行的动作。 */
export function resolveComposerSpeechSegmentAction(
  input: ResolveComposerSpeechSegmentInput,
): ComposerSpeechSegmentAction {
  const { spokenText, shouldAutoSend, voiceAction } = resolveVoiceCommand(
    input.segmentText,
    input.speechPrefs,
  );

  if (voiceAction === "clear") return { type: "clear" };
  if (voiceAction === "cancel") return { type: "cancel" };

  const autoSend = Boolean(input.forceAutoSend) || shouldAutoSend;
  const trimmed = spokenText.trim();
  if (!trimmed && !autoSend) return { type: "noop" };

  return { type: "commit", spokenText: trimmed, shouldAutoSend: autoSend };
}

/**
 * 听写过程中扫描「实时草稿」里的口播命令（清除 / 取消 / 发送），用于即时响应而无需等整段收尾。
 * 返回命令动作或 null。
 */
export function detectComposerSpeechInterimCommand(
  interimText: string,
  prefs: ComposerSpeechSegmentPrefs,
): ComposerSpeechVoiceCommandAction | null {
  if (!prefs.voiceCommandsEnabled) return null;
  const commands = buildComposerSpeechVoiceCommands(prefs);
  if (!commands.length) return null;
  return splitUtteranceAtVoiceCommand(interimText, commands).action;
}

/**
 * 实时草稿中的「收尾触发」：口播命令（清除/取消/发送）或结束词自动发送。
 * 命中后上层应立即结束当前段，由 {@link resolveComposerSpeechSegmentAction} 在 final 时统一执行，
 * 避免实时与收尾两处重复动作。
 */
export function detectComposerSpeechInterimTrigger(
  interimText: string,
  prefs: ComposerSpeechSegmentPrefs,
): ComposerSpeechVoiceCommandAction | null {
  const command = detectComposerSpeechInterimCommand(interimText, prefs);
  if (command) return command;
  if (prefs.sendMode === "endingWordAutoSend") {
    const split = splitUtteranceAtAutoSendEnding(interimText, prefs.autoSendEndingText);
    if (split.shouldAutoSend) return "send";
  }
  return null;
}
