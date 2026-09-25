import {
  feishuWebhookSend,
  loadFeishuConfig,
  loadTelegramConfig,
  loadWecomConfig,
  telegramBotSendMessage,
  wecomWebhookSend,
  type ChannelSendResult,
} from "../remoteChannels";
import type { CollabExternalChannel, CollabNotificationText } from "./channelInbox";

function ensureOk(result: ChannelSendResult, label: string): void {
  if (!result.ok) throw new Error(`${label}发送失败：${result.message || result.code || "未知错误"}`);
}

/** 通过远程入口已配置的渠道转发协作通知；未配置或失败时抛错，由渠道泵回写失败并退避重试。 */
export async function sendCollabExternalNotification(
  channel: CollabExternalChannel,
  note: CollabNotificationText,
): Promise<void> {
  const content = `${note.title}\n${note.text}`;
  switch (channel) {
    case "none":
      return;
    case "feishu": {
      const cfg = await loadFeishuConfig();
      if (!cfg?.webhookUrl?.trim()) throw new Error("飞书 Webhook 未配置");
      ensureOk(await feishuWebhookSend({ webhookUrl: cfg.webhookUrl, secret: cfg.secret ?? null, msgType: "text", content }), "飞书");
      return;
    }
    case "wecom": {
      const cfg = await loadWecomConfig();
      if (!cfg?.webhookUrl?.trim()) throw new Error("企业微信 Webhook 未配置");
      ensureOk(await wecomWebhookSend({ webhookUrl: cfg.webhookUrl, msgType: "text", content }), "企业微信");
      return;
    }
    case "telegram": {
      const cfg = await loadTelegramConfig();
      if (!cfg?.botToken?.trim() || !cfg.defaultChatId?.trim()) throw new Error("Telegram Bot 或默认 Chat 未配置");
      ensureOk(await telegramBotSendMessage({ botToken: cfg.botToken, chatId: cfg.defaultChatId, text: content }), "Telegram");
      return;
    }
  }
}
