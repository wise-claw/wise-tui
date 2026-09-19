import { Select } from "antd";
import { wiseHudSelectSession } from "../../services/wiseHud";
import { formatWorkspaceSidebarRelativeTime } from "../../utils/repositoryWorkspaceTree";
import { hudSelectPopupContainer } from "../../utils/hudSelectPopup";
import type { WiseHudSessionTab } from "../../utils/wiseHudSnapshot";

export interface HudSessionPickerProps {
  tabs: readonly WiseHudSessionTab[];
  activeSessionId: string | null;
  onPointerDown?: () => void;
}

function HudSessionOptionLabel({ tab }: { tab: WiseHudSessionTab }) {
  return (
    <span className="app-hud-session-option">
      <span className="app-hud-session-option__title">{tab.title}</span>
      <span className="app-hud-session-option__time">
        {tab.timeLabel || formatWorkspaceSidebarRelativeTime(tab.updatedAt)}
      </span>
    </span>
  );
}

export function HudSessionPicker({
  tabs,
  activeSessionId,
  onPointerDown,
}: HudSessionPickerProps) {
  if (tabs.length === 0) return null;
  const activeId =
    (activeSessionId && tabs.some((tab) => tab.id === activeSessionId) ? activeSessionId : tabs[0]?.id) ??
    undefined;

  return (
    <div className="app-hud-session-picker" onPointerDown={onPointerDown}>
      <Select
        size="small"
        className="app-hud-session-picker__select"
        classNames={{ popup: { root: "app-hud-session-picker-dropdown" } }}
        value={activeId}
        options={tabs.map((tab) => ({
          value: tab.id,
          label: <HudSessionOptionLabel tab={tab} />,
        }))}
        onChange={(sessionId) => {
          const next = String(sessionId ?? "").trim();
          if (!next || next === activeSessionId) return;
          void wiseHudSelectSession(next);
        }}
        getPopupContainer={hudSelectPopupContainer}
        popupMatchSelectWidth
        listHeight={220}
        aria-label="切换会话"
      />
    </div>
  );
}
