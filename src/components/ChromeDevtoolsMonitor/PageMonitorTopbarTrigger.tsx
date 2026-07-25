import { Popover } from "antd";
import { useCallback, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import { useChromeDevtoolsMonitor } from "../../hooks/useChromeDevtoolsMonitor";
import { PageMonitorPanel } from "./PageMonitorPanel";
import "./PageMonitorTopbarTrigger.css";

function IconPageMonitor() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect
        x="3.5"
        y="4.5"
        width="17"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 20.5h8M12 17.5v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8.2 14.2a5 5 0 0 1 7.6 0"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export type PageMonitorTopbarTriggerProps = {
  repositoryId: number | null | undefined;
  repositoryPath: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PageMonitorTopbarTrigger({
  repositoryId,
  repositoryPath,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: PageMonitorTopbarTriggerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const monitor = useChromeDevtoolsMonitor({
    repositoryId,
    repositoryPath,
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (controlledOnOpenChange) {
        controlledOnOpenChange(next);
      } else {
        setInternalOpen(next);
      }
    },
    [controlledOnOpenChange],
  );

  const disabled = !repositoryPath.trim() || !monitor.sessionId;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      classNames={{ root: "app-run-command-popover" }}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={
        <PageMonitorPanel
          urlDraft={monitor.urlDraft}
          setUrlDraft={monitor.setUrlDraft}
          autoFixEnabled={monitor.autoFixEnabled}
          setAutoFixEnabled={monitor.setAutoFixEnabled}
          chromeMode={monitor.chromeMode}
          setChromeMode={monitor.setChromeMode}
          debugPortDraft={monitor.debugPortDraft}
          setDebugPortDraft={monitor.setDebugPortDraft}
          status={monitor.status}
          statusHint={monitor.statusHint}
          issuePreview={monitor.issuePreview}
          saveUrl={monitor.saveUrl}
          start={monitor.start}
          stop={monitor.stop}
          openExtensionDir={monitor.openExtensionDir}
          onClose={() => handleOpenChange(false)}
          disabled={disabled}
        />
      }
    >
      <HoverHint
        title={
          disabled
            ? "当前会话未绑定仓库，无法监控页面"
            : monitor.isActive
              ? "页面监控进行中（点击查看）"
              : "页面监控：Chrome DevTools / CDP"
        }
        open={open ? false : undefined}
      >
        <button
          type="button"
          className={
            "app-topbar-btn app-page-monitor-topbar-btn" +
            (open || monitor.isActive ? " active" : "")
          }
          aria-label="页面监控"
          aria-expanded={open}
          disabled={disabled}
        >
          <IconPageMonitor />
          {monitor.isActive ? (
            <span className="app-page-monitor-topbar-btn__badge" aria-hidden />
          ) : null}
        </button>
      </HoverHint>
    </Popover>
  );
}
