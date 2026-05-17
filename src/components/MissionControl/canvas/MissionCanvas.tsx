import { Button, Card, Select, Space, Typography } from "antd";
import { useMemo } from "react";
import type { ProjectItem, Repository } from "../../../types";
import type { MissionViewModel } from "../presenter/types";
import type { UseSplitWizardStateApi } from "../../PrdSplitWizard/useSplitWizardState";
import type { PrdImageBucket } from "../../PrdSplitWizard/components/PrdMarkdownEditor";
import { projectToPrdSplitTarget, repositoryToPrdSplitTarget } from "../../PrdSplitWizard/targetModel";
import { PrdImportPage } from "../setup/PrdImportPage";
import { RequirementsTree } from "./RequirementsTree";
import { TaskSwimlane } from "./TaskSwimlane";
import { AgentExecutionPanel } from "./AgentExecutionPanel";
import { RequirementWorkspaceOverview } from "./RequirementWorkspaceOverview";
import { MissionReplayPanel } from "../details/MissionReplayPanel";
import { RequirementTracePanel } from "../details/RequirementTracePanel";

interface MissionCanvasProps {
  viewModel: MissionViewModel;
  api: UseSplitWizardStateApi;
  projects: ProjectItem[];
  repositories: Repository[];
  stdoutMap: Record<string, string[]>;
  onSelectRequirement: (requirementId: string) => void;
  onSelectTask: (taskId: string) => void;
  onHoverRequirement: (requirementId: string | null) => void;
  onHoverTask: (taskId: string | null) => void;
  onMoveRequirement: (requirementId: string, targetClusterId: string) => void;
  onRemoveDependency?: (taskId: string, depTaskId: string) => void;
  onRetryCluster?: (clusterId: string) => void;
  onCancelCluster?: (clusterId: string) => void;
  workspaceMode?: "overview" | "editor";
  onLoadPrd?: (markdown: string) => void;
  onNewPrd?: () => void;
  onBackToOverview?: () => void;
  onOpenLegacyImport: () => void;
  missionId?: string | null;
}

export function MissionCanvas({
  viewModel,
  api,
  projects,
  repositories,
  stdoutMap,
  onSelectRequirement,
  onSelectTask,
  onHoverRequirement,
  onHoverTask,
  onMoveRequirement,
  onRemoveDependency,
  onRetryCluster,
  onCancelCluster,
  workspaceMode = "editor",
  onLoadPrd,
  onNewPrd,
  onBackToOverview,
  onOpenLegacyImport,
  missionId,
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

    // Show workspace overview when entering from a project and in overview mode
    if (hasTarget && workspaceMode === "overview" && api.state.project) {
      return (
        <main className="mission-canvas mission-canvas--drafting">
          <div className="mission-drafting-layout">
            <RequirementWorkspaceOverview
              project={api.state.project}
              projects={projects}
              repositories={repositories}
              onLoadPrd={onLoadPrd ?? (() => {})}
              onOpenLegacyImport={onOpenLegacyImport}
              onNewPrd={onNewPrd ?? (() => {})}
            />
          </div>
        </main>
      );
    }

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
          {hasTarget ? (
            <>
              {workspaceMode === "editor" && api.state.project ? (
                <div className="prd-import-back-row">
                  <Button size="small" onClick={onBackToOverview}>
                    返回 PRD 列表
                  </Button>
                </div>
              ) : null}
              <PrdImportPage
                markdown={api.state.prdMarkdown}
                imageBucket={imageBucket}
                onMarkdownChange={api.setPrdMarkdown}
                onSubmit={async () => {
                  const result = await api.parseAndPlan();
                  if (!result.ok) api.setGlobalError(result.reason);
                }}
                onOpenLegacyImport={onOpenLegacyImport}
              />
            </>
          ) : null}
        </div>
      </main>
    );
  }

  const hasAgentActivity = Object.keys(viewModel.runState.clusters).length > 0;

  return (
    <main className="mission-canvas">
      <RequirementsTree
        tree={viewModel.requirementTree}
        onSelect={onSelectRequirement}
        onHover={onHoverRequirement}
        onMoveRequirement={onMoveRequirement}
        targetClusters={(api.state.plan?.clusters ?? []).map((c) => ({ id: c.id, title: c.title }))}
      />
      <div className="mission-canvas__orchestration">
        <TaskSwimlane
          swimlane={viewModel.taskSwimlane}
          hasHighlightedPath={viewModel.selection.highlightedTaskIds.size > 0}
          onSelectTask={onSelectTask}
          onHoverTask={onHoverTask}
          onRemoveDependency={onRemoveDependency}
          onRetryCluster={onRetryCluster}
          onCancelCluster={onCancelCluster}
        />
        {hasAgentActivity ? (
          <AgentExecutionPanel
            runState={viewModel.runState}
            stdoutMap={stdoutMap}
            onCancelCluster={onCancelCluster}
          />
        ) : null}
        <RequirementTracePanel
          missionId={missionId ?? null}
          requirementId={viewModel.selection.requirementId}
        />
        <MissionReplayPanel missionId={missionId ?? null} />
      </div>
    </main>
  );
}
