import { message, Switch } from "antd";
import { HoverHint } from "./shared/HoverHint";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { readVisiblePollIntervalMs } from "../utils/adaptivePoll";
import {
  dingtalkStreamGatewayIsRunning,
  dingtalkStreamGatewayStart,
  dingtalkStreamGatewayStop,
} from "../services/dingtalkStreamGateway";
import "./DingTalkStreamGatewayTopbarSwitch.css";

const POLL_MS = 3000;

export function DingTalkStreamGatewayTopbarSwitch() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setRunning(await dingtalkStreamGatewayIsRunning());
    } catch {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void refresh();
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refresh();
    }, readVisiblePollIntervalMs(POLL_MS, 15000));
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleChange = useCallback(
    async (checked: boolean) => {
      if (!isTauri()) return;
      setBusy(true);
      try {
        if (checked) {
          await dingtalkStreamGatewayStart();
        } else {
          await dingtalkStreamGatewayStop();
        }
        await refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (!isTauri()) {
    return null;
  }

  const tooltipTitle = running
    ? "钉钉 Stream 网关：运行中（本机直连钉钉拉流）。点击关闭。"
    : "钉钉 Stream 网关：已停止。需在「钉钉企业机器人」中保存 AppKey / AppSecret 后再开启。";

  return (
    <span
      className={`app-topbar-gateway-strip${running ? " app-topbar-gateway-strip--on" : " app-topbar-gateway-strip--off"}`}
    >
      <span className="app-topbar-gateway-label">网关</span>
      <HoverHint title={tooltipTitle}>
        <Switch
          size="small"
          checked={running}
          loading={busy}
          disabled={busy}
          onChange={(checked) => void handleChange(checked)}
          className={`app-dingtalk-stream-gateway-topbar-switch${running ? " app-dingtalk-stream-gateway-topbar-switch--on" : " app-dingtalk-stream-gateway-topbar-switch--off"}`}
          aria-label="钉钉 Stream 网关"
        />
      </HoverHint>
    </span>
  );
}
