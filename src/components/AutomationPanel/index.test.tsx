import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationPanel } from "./index";

mock.module("../../services/repositoryScheduledClaudeTasksStore", () => ({
  readRepositoryScheduledClaudeTasks: mock(async () => [
    {
      id: "task-1",
      title: "每日巡检",
      cronExpression: "0 9 * * *",
      contentMarkdown: "检查任务进度",
      employeeId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      lastExecutedAt: 3,
      lastExecuteOk: true,
    },
    {
      id: "task-2",
      title: "忙时补跑",
      cronExpression: "0 10 * * *",
      contentMarkdown: "补跑",
      employeeId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      lastExecutedAt: 4,
      lastExecuteOk: false,
      lastExecuteKind: "retrying",
      lastExecuteMessage: "会话忙或已达并发上限，空闲后补跑",
    },
    {
      id: "task-3",
      title: "无效周期",
      cronExpression: "bad",
      contentMarkdown: "x",
      employeeId: null,
      enabled: true,
      createdAt: 1,
      updatedAt: 2,
      lastExecutedAt: 5,
      lastExecuteOk: false,
      lastExecuteKind: "skipped",
      lastExecuteMessage: "Cron 表达式无效",
    },
  ]),
}));

mock.module("../../services/automationPauseStore", () => ({
  useAutomationPause: () => ({ global: false, repositoryPaths: [] }),
  hydrateAutomationPause: async () => ({ global: false, repositoryPaths: [] }),
  setGlobalAutomationPause: async () => ({ global: false, repositoryPaths: [] }),
  setRepositoryAutomationPause: async () => ({ global: false, repositoryPaths: [] }),
}));

mock.module("../RepositoryScheduledTasksModal", () => ({
  RepositoryScheduledTasksModal: ({ repositoryPath }: { repositoryPath: string }) => (
    <section data-stub="scheduled-tasks-modal">计划任务弹窗:{repositoryPath}</section>
  ),
}));

const repository = {
  id: 1,
  name: "wise",
  path: "/repo/wise",
  repositoryType: "frontend" as const,
  createdAt: "",
  updatedAt: "",
};

describe("AutomationPanel", () => {
  test("renders the automation toolbar and scheduled task entry", () => {
    const html = renderToStaticMarkup(
      <AutomationPanel
        repositories={[repository]}
        activeRepositoryId={repository.id}
      />,
    );

    expect(html).toContain("管理定时任务");
    expect(html).toContain("全局暂停");
    expect(html).toContain("app-automation-console__repos");
    expect(html).toContain("/repo/wise");
    expect(html).toContain("计划任务弹窗:/repo/wise");
    expect(html).toContain("多仓库协作调度");
    expect(html).toContain("暂停领取");
  });

  test("renders close control when onClose is provided", () => {
    const html = renderToStaticMarkup(
      <AutomationPanel
        repositories={[repository]}
        activeRepositoryId={repository.id}
        onClose={() => {}}
      />,
    );

    expect(html).toContain('aria-label="关闭"');
    expect(html).toContain("app-automation-panel-root--closable");
  });
});
