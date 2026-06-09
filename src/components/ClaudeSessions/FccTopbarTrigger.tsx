import { Popover } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { useCallback, useState } from "react";
import { useFreeClaudeCodeSetting } from "../DefaultConfigPanel/useFreeClaudeCodeSetting";
import { FreeClaudeCodePanel } from "./FreeClaudeCodePanel";
import "./FccTopbarTrigger.css";

function IconFccProxy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M12 3 4 8v8l8 5 8-5V8l-8-5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M12 12 4 8M12 12l8-4M12 12v8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export interface FccTopbarTriggerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 不渲染顶栏按钮，弹层锚定到中栏「更多」区域（供默认配置隐藏时唤起） */
  triggerHidden?: boolean;
}

export function FccTopbarTrigger({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerHidden = false,
}: FccTopbarTriggerProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const fcc = useFreeClaudeCodeSetting();
  const { status, refresh } = fcc;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (controlledOnOpenChange) {
        controlledOnOpenChange(next);
      } else {
        setInternalOpen(next);
      }
      if (next) {
        void refresh();
      }
    },
    [controlledOnOpenChange, refresh],
  );

  const running = status?.serverRunning === true;
  const needsAttention = Boolean(status && !status.claudeSettingsAligned);

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      classNames={{ root: "app-fcc-topbar-popover" }}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={<FreeClaudeCodePanel fcc={fcc} onClose={() => handleOpenChange(false)} />}
    >
      {triggerHidden ? (
        <span className="app-topbar-overflow-anchor" tabIndex={-1} aria-hidden />
      ) : (
        <HoverHint title="Free Claude Code 代理" open={open ? false : undefined}>
          <button
            type="button"
            className={"app-topbar-btn app-fcc-topbar-btn" + (open ? " active" : "")}
            aria-label="Free Claude Code"
            aria-expanded={open}
          >
            <IconFccProxy />
            {running || needsAttention ? (
              <span
                className={
                  "app-fcc-topbar-btn__badge" +
                  (running ? " app-fcc-topbar-btn__badge--live" : " app-fcc-topbar-btn__badge--warn")
                }
                aria-hidden
              />
            ) : null}
          </button>
        </HoverHint>
      )}
    </Popover>
  );
}
