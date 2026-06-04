import { loadDingTalkEnterpriseBotConfig } from "./dingtalkEnterpriseBot";
import {
  dingtalkStreamGatewayIsRunning,
  dingtalkStreamGatewayStatus,
  type DingTalkStreamGatewayStatus,
} from "./dingtalkStreamGateway";
import {
  genericWsStatus,
  loadFeishuConfig,
  loadGenericWsConfig,
  loadTelegramConfig,
  loadWecomConfig,
  type GenericWsStatus,
} from "./remoteChannels";

export type RemoteEntryStartableId = "dingtalk" | "genericWs";

export interface RemoteEntryStartableState {
  configured: boolean;
  running: boolean;
  phase: string;
  lastError?: string | null;
}

export interface RemoteEntryTopbarSnapshot {
  dingtalk: RemoteEntryStartableState;
  genericWs: RemoteEntryStartableState;
  feishuConfigured: boolean;
  wecomConfigured: boolean;
  telegramConfigured: boolean;
}

function emptyStartable(): RemoteEntryStartableState {
  return { configured: false, running: false, phase: "stopped" };
}

function mapDingtalkStatus(status: DingTalkStreamGatewayStatus): RemoteEntryStartableState {
  return {
    configured: true,
    running: status.running,
    phase: status.phase ?? (status.running ? "connected" : "stopped"),
    lastError: status.lastError ?? null,
  };
}

function mapGenericWsStatus(status: GenericWsStatus, configured: boolean): RemoteEntryStartableState {
  return {
    configured,
    running: status.running,
    phase: status.phase ?? (status.running ? "connected" : "stopped"),
    lastError: status.lastError ?? null,
  };
}

export async function loadRemoteEntryTopbarSnapshot(): Promise<RemoteEntryTopbarSnapshot> {
  const [dingtalkConfig, feishu, wecom, telegram, wsConfig] = await Promise.all([
    loadDingTalkEnterpriseBotConfig().catch(() => null),
    loadFeishuConfig().catch(() => null),
    loadWecomConfig().catch(() => null),
    loadTelegramConfig().catch(() => null),
    loadGenericWsConfig().catch(() => null),
  ]);

  const dingtalkConfigured = Boolean(
    dingtalkConfig?.appKey?.trim() && dingtalkConfig.appSecret?.trim() && dingtalkConfig.robotCode?.trim(),
  );
  const wsConfigured = Boolean(wsConfig?.url?.trim());

  let dingtalk = emptyStartable();
  if (dingtalkConfigured) {
    try {
      dingtalk = mapDingtalkStatus(await dingtalkStreamGatewayStatus());
    } catch {
      const running = await dingtalkStreamGatewayIsRunning().catch(() => false);
      dingtalk = { configured: true, running, phase: running ? "connected" : "stopped" };
    }
  }

  let genericWs = emptyStartable();
  if (wsConfigured) {
    try {
      genericWs = mapGenericWsStatus(await genericWsStatus(), true);
    } catch {
      genericWs = { configured: true, running: false, phase: "stopped" };
    }
  }

  return {
    dingtalk,
    genericWs,
    feishuConfigured: Boolean(feishu?.webhookUrl?.trim()),
    wecomConfigured: Boolean(wecom?.webhookUrl?.trim()),
    telegramConfigured: Boolean(telegram?.botToken?.trim()),
  };
}

export const REMOTE_ENTRY_STARTABLE_META: Record<
  RemoteEntryStartableId,
  { shortLabel: string; fullLabel: string }
> = {
  dingtalk: { shortLabel: "钉钉", fullLabel: "钉钉 Stream" },
  genericWs: { shortLabel: "WS", fullLabel: "通用 WebSocket" },
};
