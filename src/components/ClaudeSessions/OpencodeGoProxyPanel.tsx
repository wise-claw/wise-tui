import { CloseOutlined } from "@ant-design/icons";
import { Button, Tabs } from "antd";
import { useState } from "react";
import { OpencodeGoProxyTrafficPanel } from "../ProgressMonitorPanel/OpencodeGoProxyTrafficPanel";
import { openExternalUrl } from "../../services/openExternal";
import {
  OPENCODE_GO_PROXY_DEFAULT_PORT,
  OPENCODE_GO_USAGE_URL,
} from "../../services/opencodeGoProxy";
import { OpencodeGoProxySection } from "../DefaultConfigPanel/OpencodeGoProxySection";
import type { OpencodeGoProxySettingController } from "../DefaultConfigPanel/useOpencodeGoProxySetting";
import "../DefaultConfigPanel/OpencodeGoProxySection.css";
import "./OpencodeGoProxyPanel.css";

interface Props {
  proxy: OpencodeGoProxySettingController;
  onClose?: () => void;
}

/** 顶栏 Popover：OpenCode Go / Zen 内置代理启停与配置。 */
export function OpencodeGoProxyPanel({ proxy, onClose }: Props) {
  const [tab, setTab] = useState("config");
  const st = proxy.status;
  const running = st?.running === true;
  const port =
    proxy.portDraft > 0 ? proxy.portDraft : OPENCODE_GO_PROXY_DEFAULT_PORT;
  const localUrl =
    running && st?.proxyBaseUrl ? st.proxyBaseUrl : `http://127.0.0.1:${port}`;
  const claudeLabel = !running ? "Claude —" : st?.claudeSettingsAligned ? "Claude 已对齐" : "Claude 未对齐";
  const codexLabel = !running ? "Codex —" : st?.codexSettingsAligned ? "Codex 已对齐" : "Codex 未对齐";

  return (
    <div className="app-ocgo-topbar-panel" aria-label="OpenCode 代理">
      <header className="app-ocgo-topbar-panel__head">
        <span className="app-ocgo-topbar-panel__title">OpenCode 代理</span>
        <span className="app-ocgo-topbar-panel__head-actions">
          <Button
            type="link"
            size="small"
            onClick={() => void openExternalUrl(OPENCODE_GO_USAGE_URL)}
          >
            使用量
          </Button>
          <Button
            type="link"
            size="small"
            disabled={proxy.loading || proxy.busy}
            onClick={() => void proxy.refresh()}
          >
            刷新
          </Button>
          {onClose ? (
            <button
              type="button"
              className="app-ocgo-topbar-panel__close"
              aria-label="关闭"
              onClick={onClose}
            >
              <CloseOutlined />
            </button>
          ) : null}
        </span>
      </header>

      <div className="app-ocgo-topbar-panel__body">
        <div className="app-ocgo-topbar-panel__status-bar" aria-label="代理状态">
          <div className="app-ocgo-topbar-panel__status-main">
            <span
              className={
                "app-ocgo-topbar-panel__chip" +
                (running ? " app-ocgo-topbar-panel__chip--on" : "")
              }
            >
              {running ? "运行中" : "已停止"}
            </span>
            <span
              className={
                "app-ocgo-topbar-panel__chip" +
                (st && !st.claudeSettingsAligned && running
                  ? " app-ocgo-topbar-panel__chip--warn"
                  : running && st?.claudeSettingsAligned
                    ? " app-ocgo-topbar-panel__chip--on"
                    : "")
              }
            >
              {claudeLabel}
            </span>
            <span
              className={
                "app-ocgo-topbar-panel__chip" +
                (st && !st.codexSettingsAligned && running
                  ? " app-ocgo-topbar-panel__chip--warn"
                  : running && st?.codexSettingsAligned
                    ? " app-ocgo-topbar-panel__chip--on"
                    : "")
              }
            >
              {codexLabel}
            </span>
          </div>
          <span
            className="app-ocgo-topbar-panel__chip app-ocgo-topbar-panel__chip--mono"
            title={localUrl}
          >
            {localUrl}
          </span>
        </div>

        <Tabs
          size="small"
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "config",
              label: "配置",
              children: <OpencodeGoProxySection embedded proxy={proxy} />,
            },
            {
              key: "traffic",
              label: `流量${(st?.traceCount ?? 0) > 0 ? ` (${st?.traceCount})` : ""}`,
              children: <OpencodeGoProxyTrafficPanel active={tab === "traffic"} />,
            },
          ]}
        />
      </div>
    </div>
  );
}
