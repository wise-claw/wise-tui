import { message, Switch } from "antd";
import { HoverHint } from "./shared/HoverHint";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { startAdaptiveInterval } from "../utils/adaptivePoll";
import { isCurrentPrimaryMainWorkspaceWindowSync } from "../services/mainWindow";
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
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    const sequence = ++refreshSequenceRef.current;
    try {
      const next = await dingtalkStreamGatewayIsRunning();
      if (sequence === refreshSequenceRef.current) setRunning(next);
    } catch {
      if (sequence === refreshSequenceRef.current) setRunning(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void refresh();
    const dingtalkPrimaryMs = POLL_MS;
    const dingtalkHiddenMs = 15000;
    const dingtalkVisibleMs = isCurrentPrimaryMainWorkspaceWindowSync() ? dingtalkPrimaryMs : dingtalkHiddenMs;
    return startAdaptiveInterval(refresh, dingtalkVisibleMs, dingtalkHiddenMs * 2);
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
