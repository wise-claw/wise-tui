import { describe, expect, mock, test } from "bun:test";

let primaryWindow = true;
mock.module("./mainWindow", () => ({
  isCurrentPrimaryMainWorkspaceWindowSync: () => primaryWindow,
}));

const materializedBodies: string[] = [];
mock.module("./workspaceRequirementDispatch", () => ({
  materializeRequirementBodyImages: async (bodyMarkdown: string) => {
    materializedBodies.push(bodyMarkdown);
    const paths = [...bodyMarkdown.matchAll(/!\[(?:[^\]]*)\]\((\/[^)\s]+)\)/g)].map(
      (m) => m[1]!,
    );
    return { bodyMarkdown, imagePaths: paths };
  },
  stripMarkdownImages: (markdown: string) =>
    markdown
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  buildRequirementDispatchPayload: async (item: { bodyMarkdown: string; imagePaths: string[] }) => ({
    promptText: item.bodyMarkdown,
    imagePaths: item.imagePaths,
    executeBubbleOptions: { userBubblePrompt: item.bodyMarkdown },
  }),
}));

const appended: Array<{ id: string; bodyMarkdown: string; repositoryId: string | null }> = [];
mock.module("./workspaceRequirementsStore", () => ({
  appendWorkspaceRequirement: async (item: {
    id: string;
    bodyMarkdown: string;
    repositoryId: string | null;
  }) => {
    appended.push(item);
    return { version: 1, items: [item] };
  },
  updateWorkspaceRequirement: async (
    id: string,
    updater: (row: { id: string; lastDispatchedAt: number | null; dispatchAttemptCount: number }) => {
      id: string;
      lastDispatchedAt: number | null;
      dispatchAttemptCount: number;
    },
  ) => {
    const next = updater({ id, lastDispatchedAt: null, dispatchAttemptCount: 0 });
    return { version: 1, items: [next] };
  },
}));

const openedPanels: Array<string | undefined> = [];
mock.module("../stores/workspaceMemoPanelStore", () => ({
  openWorkspaceMemoPanel: (id?: string) => {
    openedPanels.push(id);
  },
}));

let dispatchAccepted = true;
const dispatched: Array<{ promptText: string; requirementId?: string }> = [];
mock.module("../constants/pendingTaskQueueEvents", () => ({
  dispatchRequirementToExecutionEnvironment: (detail: {
    promptText: string;
    requirementId?: string;
  }) => {
    dispatched.push(detail);
    return dispatchAccepted;
  },
}));

import { ingestChromeSelectionRequirement } from "./chromeSelectionRequirementIngest";
import type { Repository } from "../types";

const repos = [{ id: 7, name: "demo", path: "/tmp/demo" }] as unknown as Repository[];

describe("ingestChromeSelectionRequirement", () => {
  test("非主窗忽略", async () => {
    primaryWindow = false;
    const result = await ingestChromeSelectionRequirement(
      { text: "改按钮", pageUrl: "", pageTitle: "", images: [] },
      { repositories: repos, activeRepositoryId: 7 },
    );
    expect(result).toBe("ignored");
    primaryWindow = true;
  });

  test("空内容", async () => {
    const result = await ingestChromeSelectionRequirement(
      { text: "  ", pageUrl: "https://example.com", pageTitle: "x", images: [] },
      { repositories: repos, activeRepositoryId: 7 },
    );
    expect(result).toBe("empty");
  });

  test("没有仓库", async () => {
    const result = await ingestChromeSelectionRequirement(
      { text: "改按钮", pageUrl: "", pageTitle: "", images: [] },
      { repositories: [], activeRepositoryId: null },
    );
    expect(result).toBe("no-repo");
  });

  test("图文入库并派发", async () => {
    appended.length = 0;
    dispatched.length = 0;
    openedPanels.length = 0;
    materializedBodies.length = 0;
    dispatchAccepted = true;
    const result = await ingestChromeSelectionRequirement(
      {
        text: "把登录按钮改成蓝色",
        pageUrl: "https://example.com/login",
        pageTitle: "登录页",
        images: [{ alt: "当前按钮", path: "/Users/me/.wise/composer-images/chrome-selection/a.png" }],
      },
      { repositories: repos, activeRepositoryId: 7 },
    );
    expect(result).toBe("ingested");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.repositoryId).toBe("7");
    expect(materializedBodies[0]).toContain("把登录按钮改成蓝色");
    expect(materializedBodies[0]).toContain("![当前按钮](/Users/me/.wise/composer-images/chrome-selection/a.png)");
    expect(openedPanels).toEqual([appended[0]?.id]);
    expect(dispatched[0]?.requirementId).toBe(appended[0]?.id);
  });

  test("无执行环境时仍入库", async () => {
    appended.length = 0;
    dispatched.length = 0;
    dispatchAccepted = false;
    const result = await ingestChromeSelectionRequirement(
      { text: "补一个需求", pageUrl: "", pageTitle: "", images: [] },
      { repositories: repos, activeRepositoryId: null },
    );
    expect(result).toBe("ingested-undispatched");
    expect(appended).toHaveLength(1);
    expect(dispatched).toHaveLength(1);
  });
});
