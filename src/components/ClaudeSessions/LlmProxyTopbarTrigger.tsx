import { Popover } from "antd";
import { useCallback, useState, useSyncExternalStore } from "react";
import { LlmProxyTrafficPanel } from "../ProgressMonitorPanel/LlmProxyTrafficPanel";
import {
  getClaudeLlmProxyStoreSnapshot,
  refreshClaudeLlmProxyStatus,
  subscribeClaudeLlmProxyStore,
} from "../../stores/claudeLlmProxyStore";
import "./LlmProxyTopbarTrigger.css";

function IconLlmProxy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M4 8h6M14 8h6M4 16h6M14 16h6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M10 8v8M14 8v8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="7" cy="8" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="16" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

interface Props {
  repositoryPath?: string;
}

export function LlmProxyTopbarTrigger({ repositoryPath }: Props) {
  const [open, setOpen] = useState(false);
  const snapshot = useSyncExternalStore(
    subscribeClaudeLlmProxyStore,
    getClaudeLlmProxyStoreSnapshot,
    getClaudeLlmProxyStoreSnapshot,
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        void refreshClaudeLlmProxyStatus(repositoryPath);
      }
    },
    [repositoryPath],
  );

  const recordCount = snapshot.records.length;
  const listening = snapshot.status?.listening === true && snapshot.status?.running === true;
  const showBadge = snapshot.status?.listening === true || recordCount > 0;

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      overlayClassName="app-llm-proxy-topbar-popover"
      content={
        <LlmProxyTrafficPanel
          repositoryPath={repositoryPath}
          variant="popover"
        />
      }
    >
      <button
        type="button"
        className={
          "app-topbar-btn app-llm-proxy-topbar-btn" + (open ? " active" : "")
        }
        aria-label="LLM 代理"
        aria-expanded={open}
        title="LLM 代理"
      >
        <IconLlmProxy />
        {showBadge ? (
          <span
            className={
              "app-llm-proxy-topbar-btn__badge" +
              (listening ? " app-llm-proxy-topbar-btn__badge--live" : "")
            }
            aria-hidden
          />
        ) : null}
      </button>
    </Popover>
  );
}
