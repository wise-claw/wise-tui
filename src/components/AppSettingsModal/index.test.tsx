import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../../services/extensions", () => ({
  getExtensionSettingsTabs: mock(async () => []),
  readExtensionSettingsTabBody: mock(async () => "# 扩展设置"),
  listExtensions: mock(async () => []),
  reloadExtensions: mock(async () => []),
  setExtensionEnabled: mock(async () => undefined),
  getExtensionSkills: mock(async () => []),
  getExtensionThemes: mock(async () => []),
  getExtensionSettingsDeclarations: mock(async () => []),
}));

mock.module("../MilkdownViewer", () => ({
  MilkdownViewer: ({ text }: { text: string }) => <article data-stub="milkdown">{text}</article>,
}));

const { AppSettingsModal, BuiltinSettingsMoved } = await import("./index");

function renderModal(initialTab?: string) {
  return renderToStaticMarkup(
    <AntApp>
      <AppSettingsModal open onClose={mock(() => undefined)} initialTab={initialTab} />
    </AntApp>,
  );
}

describe("AppSettingsModal", () => {
  test("keeps legacy builtin settings as a compatibility notice only", () => {
    const html = renderToStaticMarkup(<BuiltinSettingsMoved extTabCount={0} />);
    expect(html).toContain("工作台配置是唯一内置设置入口");
    expect(html).toContain("引擎环境 → 工作台配置 / 运行设置 / 引擎环境");
    expect(html).toContain("暂无扩展贡献的设置页");
    expect(html).not.toContain("app-claude-config-dir-panel");
    expect(html).not.toContain("app-mcp-hub");
    expect(html).not.toContain("app-claude-sandbox-help");
  });

  test("keeps the legacy modal as a mounted compatibility shell", () => {
    const html = renderModal();
    expect(html).toContain("ant-app");
    expect(html).not.toContain("快捷键控制台");
    expect(html).not.toContain("Claude 沙箱控制台");
  });
});
