import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { PromptsPanel } from "./index";

mock.module("../PromptMilkdownField", () => ({
  PromptMilkdownField: ({ label, hint }: { label: string; hint?: string }) => (
    <section data-stub="prompt-editor">
      {label}
      {hint ?? ""}
    </section>
  ),
}));

mock.module("../../services/splitPromptLayersStore", () => ({
  loadPlatformSplitPromptLayers: mock(async () => null),
  clearProjectSplitPromptLayers: mock(async () => undefined),
  clearRepositorySplitPromptLayers: mock(async () => undefined),
  loadProjectSplitPromptLayers: mock(async () => null),
  loadRepositorySplitPromptLayers: mock(async () => null),
  saveProjectSplitPromptLayers: mock(async () => undefined),
  saveRepositorySplitPromptLayers: mock(async () => undefined),
}));

const project = {
  id: "workspace-1",
  name: "Wise 工作区",
  repositoryIds: [1],
  createdAt: 1,
  updatedAt: 1,
  rootPath: "/repo/wise",
  sddMode: "wise_trellis" as const,
};

const repository = {
  id: 1,
  name: "wise-web",
  path: "/repo/wise/web",
  repositoryType: "frontend" as const,
  createdAt: "",
  updatedAt: "",
};

describe("PromptsPanel", () => {
  test("renders prompt scope and editor without close button by default", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <PromptsPanel
          projects={[project]}
          repositories={[repository]}
          activeProjectId={project.id}
          activeRepositoryId={repository.id}
          openContext={{ project, repository }}
        />
      </AntApp>,
    );

    expect(html).toContain("当前提示词作用域");
    expect(html).not.toContain('aria-label="关闭"');
    expect(html).toContain("调用用途");
    expect(html).toContain("新建用途");
    expect(html).toContain("提示词契约");
  });

  test("renders close button when onClose is provided", () => {
    const html = renderToStaticMarkup(
      <AntApp>
        <PromptsPanel
          onClose={mock(() => {})}
          projects={[project]}
          repositories={[repository]}
          activeProjectId={project.id}
          activeRepositoryId={repository.id}
          openContext={{ project, repository }}
        />
      </AntApp>,
    );

    expect(html).toContain('aria-label="关闭"');
  });
});
