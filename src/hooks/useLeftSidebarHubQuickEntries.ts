import { useCallback, useEffect, useState } from "react";
import type { LeftSidebarHubQuickEntryId } from "../constants/leftSidebarHubQuickEntries";
import {
  loadLeftSidebarHubQuickEntriesFromStore,
  WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED,
} from "../services/wiseDefaultConfigStore";

/** 左栏 AI 工作台快捷入口显示列表（`wise.defaultConfig.v1`）。 */
export function useLeftSidebarHubQuickEntries(): {
  enabledEntryIds: LeftSidebarHubQuickEntryId[];
} {
  const [enabledEntryIds, setEnabledEntryIds] = useState<LeftSidebarHubQuickEntryId[]>([]);

  const apply = useCallback((entries: LeftSidebarHubQuickEntryId[]) => {
    setEnabledEntryIds(entries);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLeftSidebarHubQuickEntriesFromStore().then((loaded) => {
      if (!cancelled) apply(loaded);
    });
    const onChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{ leftSidebarHubQuickEntries?: LeftSidebarHubQuickEntryId[] }>
      ).detail;
      if (detail?.leftSidebarHubQuickEntries) {
        apply(detail.leftSidebarHubQuickEntries);
      }
    };
    window.addEventListener(WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WISE_LEFT_SIDEBAR_HUB_QUICK_ENTRIES_CHANGED, onChanged);
    };
  }, [apply]);

  return { enabledEntryIds };
}
