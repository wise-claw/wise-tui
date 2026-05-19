import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClaudeUserConfigDirInfo } from "../../services/claudeConfigDir";
import {
  type ChoiceKey,
  type ClaudeConfigDirChoiceState,
  type SaveValue,
  buildDirty,
  classifyRawValue,
  deriveStateFromInfo,
  resolveValueToSave as resolveSaveValue,
} from "./types";

export interface UseClaudeConfigDirChoiceResult {
  state: ClaudeConfigDirChoiceState;
  setChoice: (next: ChoiceKey) => void;
  setCustomDraft: (next: string) => void;
  dirty: boolean;
  resolveValueToSave: () => SaveValue;
  syncToInfo: (info: ClaudeUserConfigDirInfo) => void;
}

export function useClaudeConfigDirChoice(
  info: ClaudeUserConfigDirInfo | null,
): UseClaudeConfigDirChoiceResult {
  const [state, setState] = useState<ClaudeConfigDirChoiceState>({ choice: "default", customDraft: "" });

  // Mirror info → state (matches the original component which derived state inside refresh()).
  useEffect(() => {
    if (info) setState(deriveStateFromInfo(info));
  }, [info]);

  const setChoice = useCallback(
    (next: ChoiceKey) => {
      setState((prev) => {
        if (prev.choice === next) return prev;
        if (next === "custom") {
          const seed =
            info?.rawValue && classifyRawValue(info.rawValue) === "custom" ? info.rawValue : "";
          return { choice: next, customDraft: seed };
        }
        return { choice: next, customDraft: "" };
      });
    },
    [info?.rawValue],
  );

  const setCustomDraft = useCallback((next: string) => {
    setState((prev) => ({ ...prev, customDraft: next }));
  }, []);

  const syncToInfo = useCallback((next: ClaudeUserConfigDirInfo) => {
    setState(deriveStateFromInfo(next));
  }, []);

  const dirty = useMemo(() => (info ? buildDirty(state, info) : false), [info, state]);

  const resolveValueToSave = useCallback((): SaveValue => resolveSaveValue(state), [state]);

  return { state, setChoice, setCustomDraft, dirty, resolveValueToSave, syncToInfo };
}
