import { useMonitorPanelDefault } from "./useMonitorPanelDefault";

/** @deprecated 请使用 `useMonitorPanelDefault`；保留左栏可见性语义以兼容旧调用方。 */
export function useLeftSidebarMonitorPanelVisible(): { visible: boolean } {
  const { visible } = useMonitorPanelDefault();
  return { visible };
}
