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
  ]),
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
        employees={[]}
        workflowTemplates={[]}
        workflowGraphsByWorkflowId={{}}
      />,
    );

    expect(html).toContain("管理定时任务");
    expect(html).toContain("app-automation-console__repos");
    expect(html).toContain("/repo/wise");
    expect(html).toContain("计划任务弹窗:/repo/wise");
  });
});
