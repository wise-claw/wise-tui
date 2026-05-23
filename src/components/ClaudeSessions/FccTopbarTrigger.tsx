import { Popover } from "antd";
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

export function FccTopbarTrigger() {
  const [open, setOpen] = useState(false);
  const fcc = useFreeClaudeCodeSetting();
  const { status, refresh } = fcc;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        void refresh();
      }
    },
    [refresh],
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
      content={<FreeClaudeCodePanel fcc={fcc} onClose={() => setOpen(false)} />}
    >
      <button
        type="button"
        className={"app-topbar-btn app-fcc-topbar-btn" + (open ? " active" : "")}
        aria-label="Free Claude Code"
        aria-expanded={open}
        title="Free Claude Code 代理"
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
    </Popover>
  );
}
