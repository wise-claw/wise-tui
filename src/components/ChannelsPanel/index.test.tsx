import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelsPanel } from "./index";

mock.module("../DingTalkEnterpriseBotPopoverBody", () => ({
  DingTalkEnterpriseBotPopoverBody: () => <section data-stub="dingtalk-config">钉钉配置表单</section>,
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
  dingtalkStreamGatewayStop: mock(async () => undefined),
}));

describe("ChannelsPanel", () => {
  test("renders the channel list with DingTalk expanded by default", () => {
    const html = renderToStaticMarkup(<ChannelsPanel />);

    expect(html).toContain("渠道配置");
    expect(html).toContain("钉钉");
    expect(html).toContain("飞书");
    expect(html).toContain("企业微信");
    expect(html).toContain("Telegram");
    expect(html).toContain('data-stub="dingtalk-config"');
  });
});
