import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantHub } from "./AssistantHub";

mock.module("../../services/assistants", () => ({
  listAssistants: mock(async () => [
    {
      id: "builtin:ppt-deck",
      name: "PPT 演示助手",
      description: "做 PPT",
      engineId: "claude",
      source: "builtin",
      avatarColor: "#1677FF",
      defaultSkills: [],
      defaultMcps: [],
      defaultWorkflows: [],
    },
  ]),
}));

describe("AssistantHub", () => {
  test("renders recent conversations and the hub composer", () => {
    const html = renderToStaticMarkup(
      <AssistantHub
        activeProjectId="p1"
        activeProjectName="Demo"
        activeRepositoryPath="/repo/wise"
        activeRepositoryName="wise"
        lastAssistantId="builtin:ppt-deck"
        recentConversations={[
          {
            id: "ck-1",
            assistantId: "builtin:ppt-deck",
            assistantName: "PPT 演示助手",
            sessionId: "s1",
            repositoryPath: "/repo/wise",
            repositoryName: "wise",
            projectId: "p1",
            projectName: "Demo",
            title: "做一份融资路演",
            promptPreview: "做一份融资路演",
            createdAt: 1,
            updatedAt: 2,
            status: "ok",
            artifactPaths: ["slides/deck.pptx"],
          },
        ]}
        onSelectAssistant={() => {}}
        onOpenAssistantSettings={() => {}}
        onOpenChat={() => {}}
        onSendBrief={() => {}}
        onOpenRecent={() => {}}
      />,
    );

    expect(html).toContain("最近对话");
    expect(html).toContain("做一份融资路演");
    expect(html).toContain("发送");
    expect(html).toContain("工作区 Demo");
  });
});
