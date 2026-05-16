import { Empty, Spin, Tag, Typography, Collapse } from "antd";
import {
  FileTextOutlined,
  ApartmentOutlined,
  FolderOutlined,
  RightOutlined,
  HistoryOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import type {
  TrellisRequirementWorkspaceSnapshot,
  TrellisRequirementPrdRow,
  TrellisRequirementTaskRow,
} from "../../../services/trellisTaskBridge";
import {
  useRequirementWorkspace,
  buildPrdChildTaskMap,
} from "./useRequirementWorkspace";
import type { ProjectItem, Repository } from "../../../types";
import type { ProjectRef } from "../../PrdSplitWizard/types";
interface RequirementWorkspaceOverviewProps {
  project: ProjectItem | ProjectRef | null;
  projects: ProjectItem[];
  repositories: Repository[];
  onLoadPrd: (markdown: string) => void;
  onOpenLegacyImport: () => void;
  onNewPrd: () => void;
}

export function RequirementWorkspaceOverview({
  project,
  projects,
  repositories,
  onLoadPrd,
  onOpenLegacyImport,
  onNewPrd,
}: RequirementWorkspaceOverviewProps) {
  const [archiveFilter, setArchiveFilter] = useState<"active" | "all" | "archived">("active");
  const { snapshot, loading } = useRequirementWorkspace({ project, projects, repositories, includeArchived: true });
  const [repoFilter, setRepoFilter] = useState<number | null>(null);
  const repoById = useMemo(
    () => new Map(repositories.map((r) => [r.id, r])),
    [repositories],
  );

  if (!project) {
    return null;
  }

  if (loading) {
    return (
      <div className="mission-workspace-loading">
        <Spin size="small" />
        <Typography.Text type="secondary">正在扫描项目需求工作区…</Typography.Text>
      </div>
    );
  }

  if (!snapshot || (snapshot.prds.length === 0 && snapshot.tasks.length === 0)) {
    return <EmptyWorkspace onNewPrd={onNewPrd} onOpenLegacyImport={onOpenLegacyImport} />;
  }

  const visiblePrds = filterArchiveRows(snapshot.prds, archiveFilter);
  const visibleTasks = filterArchiveRows(snapshot.tasks, archiveFilter);
  const visibleSnapshot: TrellisRequirementWorkspaceSnapshot = {
    sources: snapshot.sources,
    prds: visiblePrds,
    tasks: visibleTasks,
  };
  const prdChildTasks = buildPrdChildTaskMap(visiblePrds, visibleTasks);
  const filteredPrds = repoFilter != null
    ? visiblePrds.filter((p) => p.repositoryId === repoFilter)
    : visiblePrds;

  return (
    <div className="mission-workspace-overview">
      <WorkspaceSummary
        snapshot={visibleSnapshot}
        repoById={repoById}
        repoFilter={repoFilter}
        onRepoFilter={setRepoFilter}
        archiveCounts={{
          active: snapshot.prds.filter((prd) => !prd.archived).length,
          archived: snapshot.prds.filter((prd) => prd.archived).length,
        }}
      />
      <div className="mission-workspace-toolbar">
        <button type="button" className="mission-btn-secondary" onClick={onNewPrd}>
          + 新建 PRD
        </button>
        <button type="button" className="mission-btn-secondary" onClick={onOpenLegacyImport}>
          <HistoryOutlined /> 历史导入
        </button>
        <SegmentedArchiveFilter value={archiveFilter} onChange={setArchiveFilter} />
        {repoFilter != null ? (
          <span className="mission-workspace-toolbar__filter-hint">
            正在筛选：{repoById.get(repoFilter)?.name ?? `仓库 ${repoFilter}`}
            <button type="button" className="mission-workspace-clear-filter" onClick={() => setRepoFilter(null)}>清除</button>
          </span>
        ) : null}
      </div>
      {filteredPrds.length === 0 ? (
        <div className="mission-workspace-empty-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={archiveFilter === "archived" ? "暂无已归档 PRD" : "当前筛选下没有 PRD"}
          />
        </div>
      ) : (
        <div className="mission-workspace-grid">
          {filteredPrds.map((prd) => (
            <PrdMissionCard
              key={prd.taskId}
              prd={prd}
              childTasks={prdChildTasks.get(prd.taskId) ?? []}
              repoById={repoById}
              onLoadPrd={onLoadPrd}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyWorkspace({
  onNewPrd,
  onOpenLegacyImport,
}: {
  onNewPrd: () => void;
  onOpenLegacyImport: () => void;
}) {
  return (
    <div className="mission-workspace-empty">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="当前项目尚未创建任何 PRD"
      >
        <button type="button" className="mission-btn-secondary" onClick={onNewPrd}>
          + 新建 PRD
        </button>
        <button
          type="button"
          className="mission-btn-secondary"
          style={{ marginLeft: 10 }}
          onClick={onOpenLegacyImport}
        >
          <HistoryOutlined /> 从历史导入
        </button>
      </Empty>
    </div>
  );
}

function WorkspaceSummary({
  snapshot,
  repoById,
  repoFilter,
  onRepoFilter,
  archiveCounts,
}: {
  snapshot: TrellisRequirementWorkspaceSnapshot;
  repoById: Map<number, Repository>;
  repoFilter: number | null;
  onRepoFilter: (repoId: number | null) => void;
  archiveCounts: { active: number; archived: number };
}) {
  const totalTasks = snapshot.tasks.length;
  const totalPrds = snapshot.prds.length;
  const completedTasks = snapshot.tasks.filter(
    (t) => t.status === "done" || t.status === "completed",
  ).length;

  return (
    <div className="mission-workspace-summary">
      <div className="mission-workspace-summary__left">
        <div className="mission-workspace-summary__stat">
          <FileTextOutlined />
          <span className="mission-workspace-summary__value">{totalPrds}</span>
          <span className="mission-workspace-summary__label">PRD</span>
        </div>
        <div className="mission-workspace-summary__stat">
          <ApartmentOutlined />
          <span className="mission-workspace-summary__value">{totalTasks}</span>
          <span className="mission-workspace-summary__label">任务</span>
        </div>
        {totalTasks > 0 ? (
          <div className="mission-workspace-summary__stat">
            <span className="mission-workspace-summary__value">
              {Math.round((completedTasks / totalTasks) * 100)}%
            </span>
            <span className="mission-workspace-summary__label">完成率</span>
          </div>
        ) : null}
        {archiveCounts.archived > 0 ? (
          <div className="mission-workspace-summary__stat">
            <InboxOutlined />
            <span className="mission-workspace-summary__value">{archiveCounts.archived}</span>
            <span className="mission-workspace-summary__label">归档</span>
          </div>
        ) : null}
        {/* Repo filter pills */}
        <div className="mission-workspace-summary__repos">
          <button
            type="button"
            className={`mission-workspace-repo-pill ${repoFilter === null ? "mission-workspace-repo-pill--active" : ""}`}
            onClick={() => onRepoFilter(null)}
          >
            全部
          </button>
          {snapshot.sources.map((s) => {
            const repo = repoById.get(Number(s.sourceId)) ?? null;
            const name = repo?.name ?? s.rootPath.split("/").pop() ?? s.sourceId;
            return (
              <button
                key={s.sourceId}
                type="button"
                className={`mission-workspace-repo-pill ${repoFilter === Number(s.sourceId) ? "mission-workspace-repo-pill--active" : ""}`}
                onClick={() =>
                  onRepoFilter(repoFilter === Number(s.sourceId) ? null : Number(s.sourceId))
                }
              >
                {name}
                <span className="mission-workspace-repo-pill__count">{s.prdCount}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SegmentedArchiveFilter({
  value,
  onChange,
}: {
  value: "active" | "all" | "archived";
  onChange: (value: "active" | "all" | "archived") => void;
}) {
  const options: Array<{ value: "active" | "all" | "archived"; label: string }> = [
    { value: "active", label: "活跃" },
    { value: "all", label: "全部" },
    { value: "archived", label: "已归档" },
  ];
  return (
    <div className="mission-workspace-archive-filter" role="group" aria-label="PRD archive filter">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`mission-workspace-archive-filter__btn ${
            value === option.value ? "mission-workspace-archive-filter__btn--active" : ""
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function filterArchiveRows<T extends { archived: boolean }>(
  rows: T[],
  filter: "active" | "all" | "archived",
): T[] {
  if (filter === "all") return rows;
  return rows.filter((row) => filter === "archived" ? row.archived : !row.archived);
}

const STATUS_COLOR: Record<string, string> = {
  done: "green",
  completed: "green",
  in_progress: "blue",
  planning: "orange",
  draft: "default",
};

function PrdMissionCard({
  prd,
  childTasks,
  repoById,
  onLoadPrd,
}: {
  prd: TrellisRequirementPrdRow;
  childTasks: TrellisRequirementTaskRow[];
  repoById: Map<number, Repository>;
  onLoadPrd: (markdown: string) => void;
}) {
  const repo = prd.repositoryId != null ? repoById.get(prd.repositoryId) : null;
  const reqCount = useMemo(() => {
    if (!prd.requirementsIndexJson) return 0;
    try {
      const idx = JSON.parse(prd.requirementsIndexJson);
      return idx.requirements?.length ?? 0;
    } catch {
      return 0;
    }
  }, [prd.requirementsIndexJson]);

  const collapsedTitle = childTasks.length > 0
    ? `查看 ${childTasks.length} 个子任务`
    : undefined;

  return (
    <div className={`mission-prd-card ${prd.archived ? "mission-prd-card--archived" : ""}`}>
      <div className="mission-prd-card__header">
        <span className="mission-prd-card__status-dot" data-status={prd.status} />
        <Typography.Text className="mission-prd-card__title" strong>
          {prd.title || prd.taskId}
        </Typography.Text>
        <Tag color={STATUS_COLOR[prd.status] ?? "default"} style={{ fontSize: 10, fontWeight: 700 }}>
          {prd.status}
        </Tag>
        {prd.archived ? (
          <Tag icon={<InboxOutlined />} color="default" style={{ fontSize: 10, fontWeight: 700, margin: 0 }}>
            archived
          </Tag>
        ) : null}
        {repo ? (
          <Tag icon={<FolderOutlined />} color="blue" style={{ fontSize: 10, fontWeight: 700, margin: 0 }}>
            {repo.name}
          </Tag>
        ) : null}
      </div>

      <div className="mission-prd-card__meta">
        <span className="mission-prd-card__id">{prd.taskId}</span>
        {reqCount > 0 ? (
          <span className="mission-prd-card__req-count">{reqCount} 条需求</span>
        ) : null}
        {childTasks.length > 0 ? (
          <span className="mission-prd-card__task-count">{childTasks.length} 个任务</span>
        ) : null}
      </div>

      {prd.prdMarkdown ? (
        <Typography.Paragraph
          className="mission-prd-card__preview"
          type="secondary"
          ellipsis={{ rows: 2 }}
        >
          {prd.prdMarkdown.replace(/^#.*$/m, "").trim().slice(0, 200)}
        </Typography.Paragraph>
      ) : null}

      {childTasks.length > 0 ? (
        <Collapse
          ghost
          size="small"
          className="mission-prd-card__tasks"
          items={[{
            key: "tasks",
            label: collapsedTitle,
            children: (
              <div className="mission-prd-card__task-list">
                {childTasks.map((task) => {
                  const taskRepo = task.repositoryId != null
                    ? repoById.get(task.repositoryId)
                    : null;
                  return (
                    <div key={task.taskId} className="mission-prd-task-row">
                      <span className="mission-prd-task-row__dot" data-status={task.status} />
                      <Typography.Text className="mission-prd-task-row__title">
                        {task.title}
                      </Typography.Text>
                      <span className="mission-prd-task-row__id">{task.taskId}</span>
                      {taskRepo ? (
                        <Tag style={{ fontSize: 9, lineHeight: "14px", margin: 0 }}>
                          {taskRepo.name}
                        </Tag>
                      ) : null}
                      {task.sourceRequirementIds.length > 0 ? (
                        <span className="mission-prd-task-row__reqs">
                          {task.sourceRequirementIds.join(", ")}
                        </span>
                      ) : null}
                      <Tag
                        color={STATUS_COLOR[task.status] ?? "default"}
                        style={{ fontSize: 9, lineHeight: "14px" }}
                      >
                        {task.status}
                      </Tag>
                    </div>
                  );
                })}
              </div>
            ),
          }]}
        />
      ) : null}

      {/* Only actionable when there's PRD content to continue from */}
      {prd.prdMarkdown ? (
        <button
          type="button"
          className="mission-prd-card__continue-btn"
          onClick={() => onLoadPrd(prd.prdMarkdown)}
        >
          <RightOutlined /> 继续此 PRD
        </button>
      ) : null}
    </div>
  );
}
