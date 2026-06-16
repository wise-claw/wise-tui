import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  loadSessionFeedbackLoopSettingsFromStore,
  saveSessionFeedbackLoopSettingsToStore,
  type SessionFeedbackLoopSettings,
  WISE_SESSION_FEEDBACK_LOOP_CHANGED,
} from "../../services/wiseDefaultConfigStore";

export function useSessionFeedbackLoopSetting() {
  const [settings, setSettings] = useState<SessionFeedbackLoopSettings>({
    enabled: false,
    maxCycles: 3,
    autoStart: false,
    earlyStopConvergence: true,
    autoSaveHabitsToComposer: false,
    injectHabitsToSystemPrompt: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await loadSessionFeedbackLoopSettingsFromStore());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener(WISE_SESSION_FEEDBACK_LOOP_CHANGED, handler);
    return () => window.removeEventListener(WISE_SESSION_FEEDBACK_LOOP_CHANGED, handler);
  }, [refresh]);

  const save = useCallback(
    async (patch: Partial<SessionFeedbackLoopSettings>) => {
      const next = { ...settings, ...patch };
      const unchanged =
        next.enabled === settings.enabled &&
        next.maxCycles === settings.maxCycles &&
        next.autoStart === settings.autoStart &&
        next.earlyStopConvergence === settings.earlyStopConvergence &&
        next.autoSaveHabitsToComposer === settings.autoSaveHabitsToComposer &&
        next.injectHabitsToSystemPrompt === settings.injectHabitsToSystemPrompt;
      if (unchanged) return;
      setSaving(true);
      try {
        await saveSessionFeedbackLoopSettingsToStore(patch);
        setSettings(next);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [settings],
  );

  return {
    ...settings,
    loading,
    saving,
    refresh,
    save,
    saveEnabled: (enabled: boolean) => save({ enabled }),
    saveMaxCycles: (maxCycles: number) => save({ maxCycles }),
    saveAutoStart: (autoStart: boolean) => save({ autoStart }),
    saveEarlyStopConvergence: (earlyStopConvergence: boolean) => save({ earlyStopConvergence }),
    saveAutoSaveHabitsToComposer: (autoSaveHabitsToComposer: boolean) =>
      save({ autoSaveHabitsToComposer }),
    saveInjectHabitsToSystemPrompt: (injectHabitsToSystemPrompt: boolean) =>
      save({ injectHabitsToSystemPrompt }),
  };
}
