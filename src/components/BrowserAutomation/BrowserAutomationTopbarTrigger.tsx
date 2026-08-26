import { Popover } from "antd";
import { useCallback, useEffect, useState } from "react";
import { HoverHint } from "../shared/HoverHint";
import { useStagehandBrowse } from "../../hooks/useStagehandBrowse";
import { BrowserAutomationPanel } from "./BrowserAutomationPanel";
import "./BrowserAutomationTopbarTrigger.css";

function IconBrowserAutomation() {
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
      <path d="M3.5 8h17" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="6.25" cy="6.25" r="0.7" fill="currentColor" />
      <circle cx="8.35" cy="6.25" r="0.7" fill="currentColor" />
      <circle cx="10.45" cy="6.25" r="0.7" fill="currentColor" />
      <path
        d="M8.5 13.2l2.1 2.1 4.9-5.1"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.6 19.2l1.7-3.4 1.7 3.4M16.95 18.3h3.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type BrowserAutomationTopbarTriggerProps = {
  repositoryId: number | null | undefined;
  repositoryPath: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function BrowserAutomationTopbarTrigger({
  repositoryId,
  repositoryPath,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: BrowserAutomationTopbarTriggerProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const automation = useStagehandBrowse({
    repositoryId,
    repositoryPath,
  });

  const refresh = automation.refresh;
  const isActive = automation.isActive;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) void refresh();
      if (controlledOnOpenChange) {
        controlledOnOpenChange(next);
      } else {
        setInternalOpen(next);
      }
    },
    [controlledOnOpenChange, refresh],
  );

  useEffect(() => {
    if (!open || !isActive) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [isActive, open, refresh]);

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
        <BrowserAutomationPanel
          automation={automation}
          onClose={() => handleOpenChange(false)}
        />
      }
    >
      <HoverHint
        title={
          automation.isActive
            ? `浏览器自动化进行中${automation.pageTitle ? `：${automation.pageTitle}` : ""}`
            : "浏览器自动化配置（会话输入框使用 wise browse）"
        }
        open={open ? false : undefined}
      >
        <button
          type="button"
          className={
            "app-topbar-btn app-browser-automation-topbar-btn" +
            (open || automation.isActive ? " active" : "")
          }
          aria-label="浏览器自动化"
          aria-expanded={open}
        >
          <IconBrowserAutomation />
          {automation.isActive ? (
            <span className="app-browser-automation-topbar-btn__badge" aria-hidden />
          ) : null}
        </button>
      </HoverHint>
    </Popover>
  );
}
