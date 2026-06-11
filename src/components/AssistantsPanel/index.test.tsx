import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantsPanel } from "./index";

mock.module("../../services/agentRegistry", () => ({
  listAgents: mock(async () => [
    {
      id: "claude",
      name: "Claude",
      backend: "claude",
      kind: "claude",
      available: true,
      command: "claude",
      binaryPath: "/bin/claude",
      detectedAt: "2026-05-17T00:00:00.000Z",
    },
  ]),
}));

mock.module("../../services/assistants", () => ({
  listAssistants: mock(async () => [
    {
      id: "builtin.code-reviewer",
      source: "builtin",
      name: "代码审查助手",
      description: "审查代码变更",
      avatarColor: null,
      engineId: "claude",
      model: null,
      systemPrompt: "review",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "custom.writer",
      source: "custom",
      name: "写作助手",
      description: "处理文档",
      avatarColor: null,
      engineId: "codex",
      model: "fast",
      systemPrompt: "write",
      customId: "writer",
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "extension.polish",
      source: "extension",
      name: "润色助手",
      description: "来自扩展",
      avatarColor: null,
      engineId: "gemini",
      model: null,
      systemPrompt: null,
      extensionId: "writer-kit",
      createdAt: "",
      updatedAt: "",
    },
  ]),
  saveCustomAssistant: mock(async () => ({})),
  deleteAssistant: mock(async () => undefined),
  deleteCustomAssistant: mock(async () => undefined),
}));

describe("AssistantsPanel", () => {
  test("renders assistant templates in hub card layout", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <AssistantsPanel />
      </AntApp>,
    );

    expect(html).toContain("助手模板");
    expect(html).toContain("同步模板");
    expect(html).toContain("新增模板");
    expect(html).toContain("扩展贡献");
    expect(html).toContain("app-assistants-hub-body");
  });
});
