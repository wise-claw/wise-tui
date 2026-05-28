import { message } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ensureMacTerminalsDetected,
  isMacPlatform,
  resetMacTerminalDetectionCache,
  type DetectedMacTerminal,
} from "../../services/macosTerminal";
import {
  getTerminalAppPreferenceSync,
  hydrateTerminalAppPreference,
  setTerminalAppPreference,
} from "../../services/terminalAppPreference";

export function useDefaultTerminalSetting() {
  const [detected, setDetected] = useState<readonly DetectedMacTerminal[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!isMacPlatform()) {
      setDetected([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      resetMacTerminalDetectionCache();
      const terminals = await ensureMacTerminalsDetected();
      await hydrateTerminalAppPreference();
      setDetected(terminals);
      const stored = getTerminalAppPreferenceSync();
      const validStored = stored && terminals.some((item) => item.id === stored) ? stored : null;
      if (validStored) {
        setSelectedId(validStored);
      } else if (terminals.length === 1) {
        const only = terminals[0]!.id;
        await setTerminalAppPreference(only);
        setSelectedId(only);
      } else {
        setSelectedId(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const options = useMemo(
    () => detected.map((item) => ({ label: item.label, value: item.id })),
    [detected],
  );

  const save = useCallback(
    async (id: string) => {
      if (!id || id === selectedId) return;
      setSaving(true);
      try {
        await setTerminalAppPreference(id);
        setSelectedId(id);
        const label = detected.find((item) => item.id === id)?.label ?? id;
        message.success(`已保存：默认终端 ${label}`);
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [detected, selectedId],
  );

  return {
    isMac: isMacPlatform(),
    detected,
    selectedId,
    options,
    loading,
    saving,
    refresh,
    save,
  };
}
