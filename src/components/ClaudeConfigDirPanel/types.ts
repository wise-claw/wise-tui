import {
  CLAUDE_USER_CONFIG_DIR_PRESETS,
  type ClaudeUserConfigDirInfo,
} from "../../services/claudeConfigDir";

export type ChoiceKey = "default" | "codefuse" | "custom";

export interface ClaudeConfigDirChoiceState {
  choice: ChoiceKey;
  customDraft: string;
}

/**
 * Sentinel returned by `resolveValueToSave` when the user picked "custom"
 * but left the path empty. The container shows a warning toast in that
 * case and aborts the save.
 */
export const SENTINEL_INVALID = Symbol("ClaudeConfigDir.invalid");
export type SaveValue = string | null | typeof SENTINEL_INVALID;

export function classifyRawValue(rawValue: string | null): ChoiceKey {
  const v = rawValue?.trim() ?? "";
  if (v.length === 0) return "default";
  const codefuse = CLAUDE_USER_CONFIG_DIR_PRESETS.find((p) => p.key === "codefuse");
  if (codefuse?.rawValue === v) return "codefuse";
  return "custom";
}

export function buildDirty(state: ClaudeConfigDirChoiceState, info: ClaudeUserConfigDirInfo): boolean {
  const currentChoice = classifyRawValue(info.rawValue);
  if (state.choice !== currentChoice) return true;
  if (state.choice === "custom") {
    return state.customDraft.trim() !== (info.rawValue ?? "").trim();
  }
  return false;
}

export function deriveStateFromInfo(info: ClaudeUserConfigDirInfo): ClaudeConfigDirChoiceState {
  const choice = classifyRawValue(info.rawValue);
  return {
    choice,
    customDraft: choice === "custom" ? info.rawValue ?? "" : "",
  };
}

export function resolveValueToSave(state: ClaudeConfigDirChoiceState): SaveValue {
  if (state.choice === "default") return null;
  if (state.choice === "codefuse") {
    return CLAUDE_USER_CONFIG_DIR_PRESETS.find((p) => p.key === "codefuse")?.rawValue ?? null;
  }
  const trimmed = state.customDraft.trim();
  if (!trimmed) return SENTINEL_INVALID;
  return trimmed;
}
