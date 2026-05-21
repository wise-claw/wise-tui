import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionsPanel } from "./index";

mock.module("@tauri-apps/plugin-opener", () => ({
  openPath: mock(async () => undefined),
}));

mock.module("@tauri-apps/api/path", () => ({
  homeDir: mock(async () => "/Users/test"),
}));

mock.module("../../services/extensions", () => ({
  listExtensions: mock(async () => [
    {
      name: "writer-kit",
      version: "1.2.0",
      description: "写作扩展",
      enabled: true,
      installed: true,
      error: null,
      lastActivation: null,
    },
  ]),
  reloadExtensions: mock(async () => []),
  installHelloWorldExtension: mock(async () => ({
    destPath: "/Users/test/.wise/extensions/hello-world",
    entry: {
      name: "hello-world",
      version: "0.1.0",
      description: "Reference extension",
      enabled: true,
      installed: true,
      error: null,
      lastActivation: null,
    },
  })),
  setExtensionEnabled: mock(async () => undefined),
  getExtensionSkills: mock(async () => [
    {
      id: "writer-kit.skill.polish",
      extension: "writer-kit",
      name: "润色",
      description: "改写文本",
      location: "/ext/writer/skills/polish",
    },
  ]),
  getExtensionThemes: mock(async () => [
    {
      id: "writer-kit.theme.clean",
      extension: "writer-kit",
      name: "清爽主题",
      location: "/ext/writer/themes/clean.json",
    },
  ]),
  getExtensionSettingsDeclarations: mock(async () => [
    {
      id: "writer-kit.settings.tone",
      extension: "writer-kit",
      label: "语气",
      description: "默认写作语气",
      kind: "select",
    },
  ]),
}));

describe("ExtensionsPanel", () => {
  test("renders the extension list with local actions", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <ExtensionsPanel />
      </AntApp>,
    );

    expect(html).toContain("扩展市场");
    expect(html).toContain("使用说明");
    expect(html).toContain("安装示例扩展");
    expect(html).toContain("重新扫描");
    expect(html).toContain("打开目录");
    expect(html).toContain("已安装");
    expect(html).toContain("wise-extension.json");
  });
});
