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

describe("ChannelsPanel", () => {
  test("renders the channel list with DingTalk expanded by default", () => {
    const html = renderToStaticMarkup(<ChannelsPanel />);

    expect(html).toContain("远程入口");
    expect(html).toContain("钉钉");
    expect(html).toContain("钉钉 Stream 网关");
    expect(html).toContain("飞书");
    expect(html).toContain("企业微信");
    expect(html).toContain("Telegram");
    expect(html).toContain('data-stub="dingtalk-config"');
    expect(html).toContain('data-compact="true"');
    expect(html).toContain('data-section="config"');
    expect(html).toContain("联调");
  });
});
