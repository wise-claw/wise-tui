import { message } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER,
  normalizeLeftSidebarHubQuickEntries,
  type LeftSidebarHubQuickEntryId,
} from "../../constants/leftSidebarHubQuickEntries";
import {
  loadLeftSidebarHubQuickEntriesFromStore,
  saveLeftSidebarHubQuickEntriesToStore,
} from "../../services/wiseDefaultConfigStore";

export function useLeftSidebarHubQuickEntriesSetting() {
  const [selected, setSelected] = useState<LeftSidebarHubQuickEntryId[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadLeftSidebarHubQuickEntriesFromStore();
      setSelected(loaded);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (nextRaw: LeftSidebarHubQuickEntryId[]) => {
      const next = normalizeLeftSidebarHubQuickEntries(nextRaw);
      const same =
        next.length === selected.length && next.every((id, index) => id === selected[index]);
      if (same) return;
      setSaving(true);
      try {
        await saveLeftSidebarHubQuickEntriesToStore(next);
        setSelected(next);
        message.success("已保存左栏快捷入口");
      } catch (err) {
        message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [selected],
  );

  return {
    selected,
    loading,
    saving,
    refresh,
    save,
    allEntryIds: LEFT_SIDEBAR_HUB_QUICK_ENTRY_ORDER,
  };
}
