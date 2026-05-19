import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import type { CanvasSnapshot } from "../workflowGraph/workflowX6CanvasShared";
import { WorkflowConfigModal } from "./index";

mock.module("./WorkflowCanvasEditor", () => ({
  WorkflowCanvasEditor: ({ value }: { value: CanvasSnapshot }) => (
    <section data-stub="workflow-canvas">画布节点:{value.nodes.length}</section>
  ),
}));

const employee = {
  id: "agent-1",
  name: "实现智能体",
  agentType: "executor",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  displayOrder: 1,
  repositoryIds: [],
  projectIds: ["workspace-1"],
};

const template = {
  id: "workflow-1",
  name: "需求交付协议",
  isDefault: true,
  stages: [
    {
      id: "stage-1",
      name: "实现",
      stageOrder: 0,
      assignees: [{ employeeId: "agent-1", requiredCount: 1, isRequired: true }],
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe("WorkflowConfigModal", () => {
  test("renders the AionUi-style delegation protocol workbench copy", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <WorkflowConfigModal
          open
          inline
          loading={false}
          employees={[employee]}
          templates={[template]}
          projects={[{ id: "workspace-1", name: "Wise 工作区" }]}
          workflowProjectIds={{ "workflow-1": ["workspace-1"] }}
          repositoryPath="/repo/wise"
          selectableEmployeeIds={["agent-1"]}
          onClose={mock(() => {})}
          onSaveTemplate={mock(async () => template)}
          onLoadGraphItem={mock(async () => null)}
          onSaveGraph={mock(async () => {})}
          onValidateGraph={mock(async () => ({ ok: true, errors: [] }))}
          onDeleteTemplate={mock(async () => {})}
        />
      </AntApp>,
    );

    expect(html).toContain("多智能体委派协议");
    expect(html).toContain("委派协议控制台");
    expect(html).toContain("任务拆解");
    expect(html).toContain("角色委派");
    expect(html).toContain("验收流转");
    expect(html).toContain("工作区分发");
    expect(html).toContain("协议库");
    expect(html).toContain("新建协议");
    expect(html).toContain("搜索协议名称");
    expect(html).toContain("委派画布");
    expect(html).toContain("发布协议");
    expect(html).toContain("所属工作区");
    expect(html).toContain('data-stub="workflow-canvas"');
  });
});
