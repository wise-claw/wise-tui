import { beforeEach, describe, expect, mock, test } from "bun:test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ReactNode } from "react";

const compileTrellisWorkflow = mock(async () => ({
  projectId: "p1",
  rootPath: "/repo",
  workflowPath: "/repo/.trellis/workflow.md",
  phases: [
    {
      id: "1",
      title: "Plan",
      steps: [
        {
          id: "1.1",
          title: "Brainstorm [required]",
          phaseId: "1",
          required: true,
          repeatable: false,
          once: false,
          rawHeading: "#### 1.1 Brainstorm [required]",
        },
      ],
    },
  ],
  workflowStates: [],
  platformBlocks: [{ platforms: ["codex-inline", "Claude Code"], body: "run implementation" }],
  validationIssues: [],
  compiledAt: 1,
}));

mock.module("../../../services/trellisRuntime", () => ({
  compileTrellisWorkflow,
}));

mock.module("antd", () => ({
  Alert: ({ message, description }: { message?: ReactNode; description?: ReactNode }) => (
    <section data-testid="alert">{message}{description}</section>
  ),
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Collapse: ({ items }: { items: Array<{ label: ReactNode; children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <section key={index}>
          <h3>{item.label}</h3>
          {item.children}
        </section>
      ))}
    </div>
  ),
  Empty: ({ description }: { description?: ReactNode }) => <section>{description}</section>,
  Space: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Spin: () => <span>loading</span>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Typography: {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
    Paragraph: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  },
}));

const { WorkflowGraphPanel } = await import("./WorkflowGraphPanel");

describe("WorkflowGraphPanel", () => {
  beforeEach(() => {
    compileTrellisWorkflow.mockClear();
  });

  test("renders phases, steps, platform tags, and validation state", async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<WorkflowGraphPanel projectId="p1" rootPath="/repo" />);
    });

    expect(compileTrellisWorkflow).toHaveBeenCalledWith({ projectId: "p1", rootPath: "/repo" });
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain("Phase 1");
    expect(output).toContain("Brainstorm [required]");
    expect(output).toContain("codex-inline");
    expect(output).toContain("validation");
  });

  test("highlights workflow steps for workflow.md revisions", async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <WorkflowGraphPanel projectId="p1" rootPath="/repo" selectedFilePath=".trellis/workflow.md" />,
      );
    });

    const stepRows = renderer!.root.findAll((node) =>
      typeof node.props.className === "string" &&
      node.props.className.includes("mission-workflow-step--highlighted")
    );
    expect(stepRows.length).toBe(1);
  });

  test("renders retry state when compile fails", async () => {
    compileTrellisWorkflow.mockImplementationOnce(async () => {
      throw new Error("workflow missing");
    });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<WorkflowGraphPanel projectId="p1" rootPath="/repo" />);
    });

    const output = JSON.stringify(renderer!.toJSON());
    expect(output).toContain("无法读取 workflow.md");
    expect(output).toContain("workflow missing");
  });
});
