import { Popover, Tooltip } from "antd";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { FccTrafficPanel } from "../ProgressMonitorPanel/FccTrafficPanel";
import {
  getFccTracesStoreSnapshot,
  refreshFccTracesStoreNow,
  startFccTracesPolling,
  stopFccTracesPolling,
  subscribeFccTracesStore,
} from "../../stores/fccTracesStore";
import "./FccTrafficTopbarTrigger.css";

function IconFccTraffic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M5 7h14M5 12h10M5 17h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="19" cy="7" r="1.75" fill="currentColor" />
      <circle cx="17" cy="12" r="1.75" fill="currentColor" />
      <circle cx="19" cy="17" r="1.75" fill="currentColor" />
    </svg>
  );
}

export function FccTrafficTopbarTrigger() {
  const [open, setOpen] = useState(false);
  const snapshot = useSyncExternalStore(
    subscribeFccTracesStore,
    getFccTracesStoreSnapshot,
    getFccTracesStoreSnapshot,
  );

  useEffect(() => {
    startFccTracesPolling();
    return () => stopFccTracesPolling();
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      void refreshFccTracesStoreNow();
    }
  }, []);

  const recordCount = snapshot.traces.length;
  const running = snapshot.status?.serverRunning === true;
  const showBadge = running || recordCount > 0;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      classNames={{ root: "app-fcc-traffic-topbar-popover" }}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={<FccTrafficPanel active={open} variant="popover" />}
    >
      <Tooltip title="FCC 请求流量" mouseEnterDelay={0.35}>
        <button
          type="button"
          className={
            "app-topbar-btn app-fcc-traffic-topbar-btn" + (open ? " active" : "")
          }
          aria-label="FCC 请求流量"
          aria-expanded={open}
        >
          <IconFccTraffic />
          {showBadge ? (
            <span
              className={
                "app-fcc-traffic-topbar-btn__badge" +
                (running ? " app-fcc-traffic-topbar-btn__badge--live" : "")
              }
              aria-hidden
            />
          ) : null}
        </button>
      </Tooltip>
    </Popover>
  );
}
