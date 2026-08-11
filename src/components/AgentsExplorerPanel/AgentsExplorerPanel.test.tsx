import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentsDirectoryScan } from "../../types/agentsExplorer";
import { AgentsExplorerPanel, buildRows, scanCounts } from "./AgentsExplorerPanel";

const sampleScan: AgentsDirectoryScan = {
  rootPath: "/repo/.agents",
  exists: true,
  commands: [
    {
      name: "review",
      relPath: "commands/review.md",
      path: "/repo/.agents/commands/review.md",
      description: "代码审查",
      allowedTools: "Bash, Read",
      model: "sonnet",
    },
  ],
  skills: [
    {
      name: "weather",
      relPath: "skills/weather/SKILL.md",
      path: "/repo/.agents/skills/weather/SKILL.md",
      description: "查询天气",
    },
  ],
  agents: [
    {
      name: "tester",
      relPath: "agents/tester.md",
      path: "/repo/.agents/agents/tester.md",
      description: "测试智能体",
      model: "gpt-5",
      tools: ["Bash", "Read"],
    },
  ],
  others: [{ name: "hooks", relPath: "hooks", path: "/repo/.agents/hooks", isDir: true }],
};

mock.module("../../services/agentsExplorer", () => ({
  scanAgentsDirectory: mock(async () => sampleScan),
  readAgentsFile: mock(async () => ({
    path: "/repo/.agents/commands/review.md",
    content: "# review",
    truncated: false,
  })),
}));

mock.module("../../services/repository", () => ({
  openInFinder: mock(async () => undefined),
}));

describe("AgentsExplorerPanel", () => {
  test("renders header, category tabs and toolbar", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <AgentsExplorerPanel repositoryPath="/repo" />
      </AntApp>,
    );

    expect(html).toContain("Agents 探索");
    expect(html).toContain("浏览仓库 .agents 目录下的命令、技能、智能体与资产");
    expect(html).toContain("命令");
    expect(html).toContain("技能");
    expect(html).toContain("智能体");
    expect(html).toContain("其他");
    expect(html).toContain("打开目录");
    expect(html).toContain("刷新");
  });

  test("buildRows maps and filters scanned entries", () => {
    expect(buildRows(sampleScan, "commands", "")).toEqual([
      expect.objectContaining({
        name: "/review",
        description: "代码审查",
        relPath: "commands/review.md",
        tags: ["工具: Bash, Read", "模型: sonnet"],
      }),
    ]);

    expect(buildRows(sampleScan, "skills", "")[0].name).toBe("weather");
    expect(buildRows(sampleScan, "agents", "")[0]).toEqual(
      expect.objectContaining({ name: "tester", tags: ["模型: gpt-5", "工具: Bash, Read"] }),
    );
    expect(buildRows(sampleScan, "others", "")[0]).toEqual(
      expect.objectContaining({ name: "hooks/", description: "目录", tags: ["目录"] }),
    );

    expect(buildRows(sampleScan, "commands", "审查")).toHaveLength(1);
    expect(buildRows(sampleScan, "commands", "不存在的词")).toHaveLength(0);
    expect(buildRows(sampleScan, "agents", "Bash")).toHaveLength(1);
  });

  test("scanCounts reports category sizes", () => {
    expect(scanCounts(sampleScan)).toEqual({ commands: 1, skills: 1, agents: 1, others: 1 });
  });
});
