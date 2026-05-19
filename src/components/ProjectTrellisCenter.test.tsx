import { describe, expect, mock, test } from "bun:test";
import { App as AntApp } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProjectItem, Repository } from "../types";

mock.module("../hooks/useTrellisRuntime", () => ({
  useTrellisRuntime: ({ enabled }: { enabled?: boolean } = {}) => ({
    agentGraph: enabled
      ? {
          nodes: [{ id: "agent-a", nodeType: "agent", label: "Agent A", status: "running", metadata: {} }],
          edges: [],
          runs: [],
        }
      : null,
    events: enabled
      ? [{
          eventId: "event-a",
          rootPath: "/repo/wise",
          eventKind: "trellis.agent.start",
          payload: {},
          createdAt: 1_700_000_000_000,
        }]
      : [],
    onboarding: enabled
      ? {
          rootPath: "/repo/wise",
          status: "ready",
          inspectedAt: 1_700_000_000_000,
          checks: [
            {
              id: "trellis_dir",
              label: "Trellis directory",
              status: "pass",
              severity: "info",
              detail: "Found /repo/wise/.trellis",
              evidence: {},
            },
          ],
        }
      : null,
    loading: false,
  }),
}));

mock.module("../services/trellisSpecBridge", () => ({
  listTrellisSpecAreas: mock(async () => [
    { area: "frontend", hasIndex: true, mdFileCount: 7 },
    { area: "guides", hasIndex: true, mdFileCount: 7 },
  ]),
  listTrellisSpecTree: mock(async () => [
    {
      name: "frontend",
      relativePath: "frontend",
      nodeType: "directory",
      children: [
        {
          name: "index.md",
          relativePath: "frontend/index.md",
          nodeType: "file",
          sizeBytes: 1024,
          children: [],
        },
        {
          name: "component-guidelines.md",
          relativePath: "frontend/component-guidelines.md",
          nodeType: "file",
          sizeBytes: 2048,
          children: [],
        },
      ],
    },
  ]),
  readTrellisSpecFile: mock(async () => ({
    relativePath: "frontend/index.md",
    content: "# Frontend",
    sizeBytes: 1024,
  })),
  writeTrellisSpecFile: mock(async () => {}),
}));

mock.module("./MissionControl/engineering/SpecLibraryPanel", () => ({
  SpecLibraryPanel: () => <section data-stub="spec-editor">index 编辑器</section>,
}));

const { ProjectTrellisCenter } = await import("./ProjectTrellisCenter");

const project: ProjectItem = {
  id: "project-a",
  name: "Wise",
  repositoryIds: [],
  createdAt: 0,
  updatedAt: 0,
  rootPath: "/repo/wise",
  sddMode: "wise_trellis",
};

const repository: Repository = {
  id: 1,
  name: "wise",
  path: "/repo/wise",
  repositoryType: "frontend",
  createdAt: "0",
  updatedAt: "0",
};

function renderCenter(input: { open?: boolean; project?: ProjectItem | null; repositories?: Repository[] } = {}) {
  return renderToStaticMarkup(
    <AntApp>
      <ProjectTrellisCenter
        open={input.open ?? true}
        inline
        project={input.project === undefined ? project : input.project}
        repositories={input.repositories ?? []}
      />
    </AntApp>,
  );
}

describe("ProjectTrellisCenter", () => {
  test("renders Trellis as a workspace runtime with a compact status bar", () => {
    const html = renderCenter();
    for (const text of ["根目录就绪", "Wise 接管", "/repo/wise"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("Spec 注入");
  });

  test("exposes product tabs for editable spec, workflow map, and runtime overview", () => {
    const html = renderCenter();
    expect(html).toContain("规范库");
    expect(html).toContain("工作流图");
    expect(html).toContain("运行证据");
    expect(html).toContain("Spec");
  });

  test("keeps unavailable project state readable", () => {
    const html = renderCenter({ project: null });
    expect(html).toContain("未绑定根目录");
  });

  test("blocks workspace Trellis when rootPath points at a member repository", () => {
    const html = renderCenter({
      project: { ...project, repositoryIds: [repository.id] },
      repositories: [repository],
    });
    expect(html).toContain("当前 Workspace rootPath 指向成员仓库");
    expect(html).toContain("Standalone Repo 才使用仓库级 .trellis");
  });

  test("does not render inline content while closed", () => {
    const html = renderCenter({ open: false });
    expect(html).not.toContain("根目录就绪");
  });
});
