import { Popover } from "antd";
import { HoverHint } from "../shared/HoverHint";
import { useCallback, useState } from "react";
import { useOpencodeGoProxySetting } from "../DefaultConfigPanel/useOpencodeGoProxySetting";
import { OpencodeGoProxyPanel } from "./OpencodeGoProxyPanel";
import "./OpencodeGoProxyTopbarTrigger.css";

function IconOpencodeProxy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8.5 12h7M12 8.5v7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

export interface OpencodeGoProxyTopbarTriggerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerHidden?: boolean;
}

export function OpencodeGoProxyTopbarTrigger({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerHidden = false,
}: OpencodeGoProxyTopbarTriggerProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const proxy = useOpencodeGoProxySetting();
  const { status, refresh } = proxy;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        void proxy.persistPrefs({ silent: true, includeApiKey: true });
      }
      if (controlledOnOpenChange) {
        controlledOnOpenChange(next);
      } else {
        setInternalOpen(next);
      }
      if (next) {
        void refresh();
      }
    },
    [controlledOnOpenChange, proxy, refresh],
  );

  const running = status?.running === true;
  const needsAttention = Boolean(status && !status.claudeSettingsAligned);

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={handleOpenChange}
      classNames={{ root: "app-ocgo-topbar-popover" }}
      styles={{
        container: { padding: 0 },
        content: { padding: 0 },
      }}
      content={<OpencodeGoProxyPanel proxy={proxy} onClose={() => handleOpenChange(false)} />}
    >
      {triggerHidden ? (
        <span className="app-topbar-overflow-anchor" tabIndex={-1} aria-hidden />
      ) : (
        <HoverHint title="OpenCode 代理（Go / Zen）" open={open ? false : undefined}>
          <button
            type="button"
            className={"app-topbar-btn app-ocgo-topbar-btn" + (open ? " active" : "")}
            aria-label="OpenCode 代理"
            aria-expanded={open}
          >
            <IconOpencodeProxy />
            {running || needsAttention ? (
              <span
                className={
                  "app-ocgo-topbar-btn__badge" +
                  (running ? " app-ocgo-topbar-btn__badge--live" : " app-ocgo-topbar-btn__badge--warn")
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
