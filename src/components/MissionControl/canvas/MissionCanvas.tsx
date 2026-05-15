import { Button, Card, Select, Space, Typography } from "antd";
import { HistoryOutlined, FileTextOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import type { ProjectItem, Repository } from "../../../types";
import type { MissionViewModel } from "../presenter/types";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import { PrdMarkdownEditor, type PrdImageBucket } from "../../PrdSplitWizard/components/PrdMarkdownEditor";
import { projectToPrdSplitTarget, repositoryToPrdSplitTarget } from "../../PrdSplitWizard/targetModel";
import { COPY } from "../copy";
import { RequirementsTree } from "./RequirementsTree";
import { TaskSwimlane } from "./TaskSwimlane";

interface MissionCanvasProps {
  viewModel: MissionViewModel;
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
  onSelectRequirement: (requirementId: string) => void;
  onSelectTask: (taskId: string) => void;
  onOpenLegacyImport: () => void;
}

export function MissionCanvas({
  viewModel,
  api,
  projects,
  repositories,
  onSelectRequirement,
  onSelectTask,
  onOpenLegacyImport,
}: MissionCanvasProps) {
  const isDrafting = viewModel.phase === "drafting";
  const hasRequirements = viewModel.requirementTree.length > 0;

  const imageBucket = useMemo<PrdImageBucket | null>(() => {
    const repo = api.state.repositories[0];
    if (!repo && !api.state.project) return null;
    return {
      repositoryPath: repo?.path ?? api.state.project?.rootPath ?? "",
      repositoryName: repo?.name ?? null,
      repositoryId: repo?.id ?? null,
      projectName: api.state.project?.name ?? null,
      projectId: api.state.project?.id ?? null,
    };
  }, [api.state.project, api.state.repositories]);

  if (isDrafting && !hasRequirements) {
    const hasTarget = Boolean(api.state.project);
    const canSubmit = api.state.prdMarkdown.trim().length > 0 && hasTarget;

    const eligibleProjects = projects.filter((p) => (p.rootPath ?? "").trim().length > 0);
    const eligibleRepos = repositories.filter((r) => (r.path ?? "").trim().length > 0);

    return (
      <main className="mission-canvas mission-canvas--drafting">
        <div className="mission-drafting-layout">
          {!hasTarget && (
            <Card className="mission-drafting-card" size="small" title="选择目标">
              <Space direction="vertical" style={{ width: "100%" }}>
                <Select
                  style={{ width: "100%" }}
                  placeholder="选择项目…"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={eligibleProjects.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(projectId) => {
                    if (!projectId) return;
                    const project = projects.find((p) => p.id === projectId);
                    if (!project) return;
                    const target = projectToPrdSplitTarget(project, repositories);
                    api.reset(target.project, target.repositories, target.context);
                  }}
                />
                <Typography.Text type="secondary">或</Typography.Text>
                <Select
                  style={{ width: "100%" }}
                  placeholder="选择仓库…"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={eligibleRepos.map((r) => ({ value: r.id, label: r.name }))}
                  onChange={(repoId) => {
                    if (repoId == null) return;
                    const repo = repositories.find((r) => r.id === repoId);
                    if (!repo) return;
                    const target = repositoryToPrdSplitTarget(repo);
                    api.reset(target.project, target.repositories, target.context);
                  }}
                />
              </Space>
            </Card>
          )}
          <Card
            className="mission-drafting-card"
            title={
              <Space>
                <FileTextOutlined />
                <span>{COPY.inlinePrd.title}</span>
              </Space>
            }
            extra={
              <Space>
                <Button icon={<HistoryOutlined />} size="small" onClick={onOpenLegacyImport}>
                  {COPY.inlinePrd.importLegacy}
                </Button>
                <Button
                  type="primary"
                  size="small"
                  disabled={!canSubmit}
                  onClick={() => {
                    const result = api.parseAndPlan();
                    if (!result.ok) api.setGlobalError(result.reason);
                  }}
                >
                  {COPY.inlinePrd.submit}
                </Button>
              </Space>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 13 }}>
              {COPY.inlinePrd.hint}
            </Typography.Paragraph>
            <PrdMarkdownEditor
              value={api.state.prdMarkdown}
              onChange={api.setPrdMarkdown}
              imageBucket={imageBucket}
              floatingToolbar
              minHeight={420}
            />
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
              {COPY.inlinePrd.charCount(api.state.prdMarkdown.length)}
            </Typography.Text>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="mission-canvas">
      <RequirementsTree
        tree={viewModel.requirementTree}
        onSelect={onSelectRequirement}
        onMoveRequirement={() => {}}
      />
      <TaskSwimlane
        swimlane={viewModel.taskSwimlane}
        hasHighlightedPath={viewModel.selection.highlightedTaskIds.size > 0}
        onSelectTask={onSelectTask}
      />
    </main>
  );
}
