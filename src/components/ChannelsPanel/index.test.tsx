import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelsPanel } from "./index";

mock.module("../DingTalkEnterpriseBotPopoverBody", () => ({
  DingTalkEnterpriseBotPopoverBody: ({
    compact,
    initialSection,
  }: {
    compact?: boolean;
    initialSection?: string;
  }) => (
    <section data-stub="dingtalk-config" data-compact={String(Boolean(compact))} data-section={initialSection ?? "config"}>
      钉钉配置表单
    </section>
  ),
}));

mock.module("../../services/dingtalkEnterpriseBot", () => ({
  loadDingTalkEnterpriseBotConfig: mock(async () => ({
    appKey: "app-key",
    appSecret: "app-secret",
    robotCode: "robot-code",
  })),
}));

mock.module("../../services/dingtalkStreamGateway", () => ({
  dingtalkStreamGatewayIsRunning: mock(async () => true),
  dingtalkStreamGatewayStart: mock(async () => undefined),
  dingtalkStreamGatewayStatus: mock(async () => ({
    running: true,
    phase: "connected",
    connectedAt: "2026-05-20T00:00:00.000Z",
    lastInboundAt: null,
    lastErrorAt: null,
    lastError: null,
  })),
  dingtalkStreamGatewayStop: mock(async () => undefined),
}));

mock.module("../../services/remoteChannels", () => ({
  FEISHU_SETTINGS_KEY: "wise.channels.feishu.v1",
  WECOM_SETTINGS_KEY: "wise.channels.wecom.v1",
  TELEGRAM_SETTINGS_KEY: "wise.channels.telegram.v1",
  GENERIC_WS_SETTINGS_KEY: "wise.channels.genericWs.v1",
  loadFeishuConfig: mock(async () => null),
  saveFeishuConfig: mock(async () => undefined),
  clearFeishuConfig: mock(async () => undefined),
  feishuWebhookSend: mock(async () => ({ ok: true, raw: {} })),
  feishuWebhookTest: mock(async () => ({ ok: true, raw: {} })),
  loadWecomConfig: mock(async () => null),
  saveWecomConfig: mock(async () => undefined),
  clearWecomConfig: mock(async () => undefined),
  wecomWebhookSend: mock(async () => ({ ok: true, raw: {} })),
  wecomWebhookTest: mock(async () => ({ ok: true, raw: {} })),
  loadTelegramConfig: mock(async () => null),
  saveTelegramConfig: mock(async () => undefined),
  clearTelegramConfig: mock(async () => undefined),
  telegramBotSendMessage: mock(async () => ({ ok: true, raw: {} })),
  telegramBotTest: mock(async () => ({ ok: true, raw: {} })),
  loadGenericWsConfig: mock(async () => null),
  saveGenericWsConfig: mock(async () => undefined),
  clearGenericWsConfig: mock(async () => undefined),
  genericWsStart: mock(async () => ({ running: true, phase: "connecting" })),
  genericWsStop: mock(async () => ({ running: false, phase: "stopped" })),
  genericWsStatus: mock(async () => ({ running: false, phase: "stopped" })),
  genericWsSendText: mock(async () => undefined),
}));

mock.module("@tauri-apps/api/event", () => ({
  listen: mock(async () => () => undefined),
}));

describe("ChannelsPanel", () => {
  test("renders the channel list with DingTalk expanded by default", () => {
    const html = renderToStaticMarkup(<ChannelsPanel />);

    expect(html).toContain("远程入口");
    expect(html).toContain("钉钉");
    expect(html).toContain("钉钉 Stream 网关");
    expect(html).toContain("飞书");
    expect(html).toContain("企业微信");
    expect(html).toContain("Telegram");
    expect(html).toContain("通用 WebSocket");
    expect(html).toContain('data-stub="dingtalk-config"');
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('data-section="config"');
    expect(html).toContain("联调");
    expect(html).toContain("中继");
  });
});
