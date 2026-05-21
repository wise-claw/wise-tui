import { invoke } from "@tauri-apps/api/core";
import { getAppSettingJson, setAppSettingJson, deleteAppSetting } from "./appSettingsStore";

/** 后端 `remote_channels.rs` 统一返回的发送结果。 */
export interface ChannelSendResult {
  ok: boolean;
  code?: string | null;
  message?: string | null;
  raw: unknown;
}

// ──────────────────── 飞书自建机器人 Webhook ────────────────────

export const FEISHU_SETTINGS_KEY = "wise.channels.feishu.v1";

export interface FeishuWebhookConfig {
  webhookUrl: string;
  /** 可选「签名校验」secret，启用后必填。 */
  secret?: string;
  /** 默认 text；支持 text / post。 */
  defaultMsgType?: "text" | "post";
  /** 联调时的默认标题（post 类型生效）。 */
  defaultTitle?: string;
}

export async function loadFeishuConfig(): Promise<FeishuWebhookConfig | null> {
  return getAppSettingJson<FeishuWebhookConfig>(FEISHU_SETTINGS_KEY);
}

export async function saveFeishuConfig(config: FeishuWebhookConfig): Promise<void> {
  await setAppSettingJson(FEISHU_SETTINGS_KEY, config);
}

export async function clearFeishuConfig(): Promise<void> {
  await deleteAppSetting(FEISHU_SETTINGS_KEY);
}

export async function feishuWebhookSend(args: {
  webhookUrl: string;
  secret?: string | null;
  msgType?: "text" | "post";
  content: string;
  title?: string | null;
}): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("feishu_webhook_send", {
    args: {
      webhookUrl: args.webhookUrl.trim(),
      secret: args.secret?.trim() ?? null,
      msgType: args.msgType,
      content: args.content,
      title: args.title?.trim() ?? null,
    },
  });
}

export async function feishuWebhookTest(args: {
  webhookUrl: string;
  secret?: string | null;
}): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("feishu_webhook_test", {
    webhookUrl: args.webhookUrl.trim(),
    secret: args.secret?.trim() ?? null,
  });
}

// ──────────────────── 企业微信群机器人 Webhook ────────────────────

export const WECOM_SETTINGS_KEY = "wise.channels.wecom.v1";

export interface WecomWebhookConfig {
  webhookUrl: string;
  defaultMsgType?: "text" | "markdown";
}

export async function loadWecomConfig(): Promise<WecomWebhookConfig | null> {
  return getAppSettingJson<WecomWebhookConfig>(WECOM_SETTINGS_KEY);
}

export async function saveWecomConfig(config: WecomWebhookConfig): Promise<void> {
  await setAppSettingJson(WECOM_SETTINGS_KEY, config);
}

export async function clearWecomConfig(): Promise<void> {
  await deleteAppSetting(WECOM_SETTINGS_KEY);
}

export async function wecomWebhookSend(args: {
  webhookUrl: string;
  msgType?: "text" | "markdown";
  content: string;
}): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("wecom_webhook_send", {
    args: {
      webhookUrl: args.webhookUrl.trim(),
      msgType: args.msgType,
      content: args.content,
    },
  });
}

export async function wecomWebhookTest(webhookUrl: string): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("wecom_webhook_test", {
    webhookUrl: webhookUrl.trim(),
  });
}

// ──────────────────── Telegram Bot ────────────────────

export const TELEGRAM_SETTINGS_KEY = "wise.channels.telegram.v1";

export interface TelegramBotConfig {
  botToken: string;
  defaultChatId?: string;
  defaultParseMode?: "Markdown" | "MarkdownV2" | "HTML";
}

export async function loadTelegramConfig(): Promise<TelegramBotConfig | null> {
  return getAppSettingJson<TelegramBotConfig>(TELEGRAM_SETTINGS_KEY);
}

export async function saveTelegramConfig(config: TelegramBotConfig): Promise<void> {
  await setAppSettingJson(TELEGRAM_SETTINGS_KEY, config);
}

export async function clearTelegramConfig(): Promise<void> {
  await deleteAppSetting(TELEGRAM_SETTINGS_KEY);
}

export async function telegramBotSendMessage(args: {
  botToken: string;
  chatId: string;
  text: string;
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  disableNotification?: boolean;
}): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("telegram_bot_send_message", {
    args: {
      botToken: args.botToken.trim(),
      chatId: args.chatId.trim(),
      text: args.text,
      parseMode: args.parseMode,
      disableNotification: args.disableNotification,
    },
  });
}

export async function telegramBotTest(botToken: string): Promise<ChannelSendResult> {
  return invoke<ChannelSendResult>("telegram_bot_test", {
    botToken: botToken.trim(),
  });
}

// ──────────────────── 通用 WebSocket 客户端 ────────────────────

export const GENERIC_WS_SETTINGS_KEY = "wise.channels.genericWs.v1";

export interface GenericWebSocketConfig {
  url: string;
  bearerToken?: string;
  protocol?: string;
  /** 自动重启：当前未实现重试逻辑，留为后续扩展。 */
  autoRestart?: boolean;
}

export interface GenericWsStatus {
  running: boolean;
  url?: string | null;
  phase: "stopped" | "connecting" | "connected" | "reconnecting" | string;
  startedAt?: string | null;
  connectedAt?: string | null;
  lastInboundAt?: string | null;
  lastErrorAt?: string | null;
  lastError?: string | null;
  lastStoppedAt?: string | null;
}

export interface GenericWsInboundEvent {
  at: string;
  kind: "text" | "binary" | string;
  text?: string | null;
  binarySize?: number | null;
}

export async function loadGenericWsConfig(): Promise<GenericWebSocketConfig | null> {
  return getAppSettingJson<GenericWebSocketConfig>(GENERIC_WS_SETTINGS_KEY);
}

export async function saveGenericWsConfig(config: GenericWebSocketConfig): Promise<void> {
  await setAppSettingJson(GENERIC_WS_SETTINGS_KEY, config);
}

export async function clearGenericWsConfig(): Promise<void> {
  await deleteAppSetting(GENERIC_WS_SETTINGS_KEY);
}

export async function genericWsStart(args: GenericWebSocketConfig): Promise<GenericWsStatus> {
  return invoke<GenericWsStatus>("generic_ws_start", {
    args: {
      url: args.url.trim(),
      bearerToken: args.bearerToken?.trim() || null,
      protocol: args.protocol?.trim() || null,
    },
  });
}

export async function genericWsStop(): Promise<GenericWsStatus> {
  return invoke<GenericWsStatus>("generic_ws_stop");
}

export async function genericWsStatus(): Promise<GenericWsStatus> {
  return invoke<GenericWsStatus>("generic_ws_status");
}

export async function genericWsSendText(text: string): Promise<void> {
  await invoke("generic_ws_send_text", { text });
}
