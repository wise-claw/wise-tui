import { GatewayOutlined } from "@ant-design/icons";
import { Switch, Tooltip } from "antd";
import { isTauri } from "@tauri-apps/api/core";
import { useRemoteEntryTopbar } from "../hooks/useRemoteEntryTopbar";
import {
  REMOTE_ENTRY_STARTABLE_META,
  type RemoteEntryStartableId,
} from "../services/remoteEntryTopbar";
import "./RemoteEntryTopbarStrip.css";

function phaseHint(phase: string, lastError?: string | null): string {
  if (lastError?.trim()) return lastError.trim();
  if (phase === "connected") return "已连接";
  if (phase === "connecting") return "连接中";
  if (phase === "reconnecting") return "重连中";
  return "未运行";
}

export interface RemoteEntryTopbarStripProps {
  onOpenRemoteChannels?: () => void;
}

export function RemoteEntryTopbarStrip({ onOpenRemoteChannels }: RemoteEntryTopbarStripProps) {
  const {
    startableEntries,
    anyRunning,
    webhookConfiguredCount,
    busyId,
    toggleDingtalk,
    toggleGenericWs,
  } = useRemoteEntryTopbar();

  if (!isTauri()) {
    return null;
  }

  const configTitle =
    startableEntries.length > 0 || webhookConfiguredCount > 0
      ? "打开远程入口配置（钉钉、飞书、企微、Telegram、WebSocket）"
      : "配置远程入口：钉钉 Stream、Webhook 与通用 WebSocket";

  const summaryTitle =
    startableEntries.length === 0
      ? webhookConfiguredCount > 0
        ? `已配置 ${webhookConfiguredCount} 个 Webhook 渠道（无长连接入口）`
        : "尚未配置远程入口"
      : anyRunning
        ? "部分远程长连接入口运行中"
        : "远程长连接入口已停止";

  return (
    <span
      className={`app-topbar-remote-strip${anyRunning ? " app-topbar-remote-strip--on" : " app-topbar-remote-strip--off"}`}
    >
      <Tooltip title={summaryTitle} mouseEnterDelay={0.35}>
        <span className="app-topbar-remote-label">远程</span>
      </Tooltip>

      {startableEntries.map(({ id, state }) => {
        const meta = REMOTE_ENTRY_STARTABLE_META[id];
        const loading = busyId === id;
        const onToggle = id === "dingtalk" ? toggleDingtalk : toggleGenericWs;
        return (
          <RemoteEntryTopbarSwitch
            key={id}
            id={id}
            shortLabel={meta.shortLabel}
            fullLabel={meta.fullLabel}
            running={state.running}
            loading={loading}
            disabled={loading}
            phaseHint={phaseHint(state.phase, state.lastError)}
            onChange={(next) => void onToggle(next)}
          />
        );
      })}

      {onOpenRemoteChannels ? (
        <Tooltip title={configTitle} mouseEnterDelay={0.35}>
          <button
            type="button"
            className="app-topbar-remote-config-btn"
            aria-label="远程入口配置"
            onClick={onOpenRemoteChannels}
          >
            <GatewayOutlined />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}

interface RemoteEntryTopbarSwitchProps {
  id: RemoteEntryStartableId;
  shortLabel: string;
  fullLabel: string;
  running: boolean;
  loading: boolean;
  disabled: boolean;
  phaseHint: string;
  onChange: (next: boolean) => void;
}

function RemoteEntryTopbarSwitch({
  id,
  shortLabel,
  fullLabel,
  running,
  loading,
  disabled,
  phaseHint: hint,
  onChange,
}: RemoteEntryTopbarSwitchProps) {
  const tooltip = running
    ? `${fullLabel}：${hint}。点击关闭。`
    : `${fullLabel}：${hint}。点击启动。`;

  return (
    <span className={`app-topbar-remote-entry app-topbar-remote-entry--${id}`}>
      <span className="app-topbar-remote-entry-label">{shortLabel}</span>
      <Tooltip title={tooltip} mouseEnterDelay={0.35}>
        <Switch
          size="small"
          checked={running}
          loading={loading}
          disabled={disabled}
          onChange={(checked) => onChange(checked)}
          className={
            "app-topbar-remote-entry-switch" +
            (running ? " app-topbar-remote-entry-switch--on" : " app-topbar-remote-entry-switch--off")
          }
          aria-label={`${fullLabel}开关`}
        />
      </Tooltip>
    </span>
  );
}
