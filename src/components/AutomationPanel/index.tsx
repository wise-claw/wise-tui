import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Select, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeItem, Repository, RepositoryScheduledClaudeTask, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { readRepositoryScheduledClaudeTasks } from "../../services/repositoryScheduledClaudeTasksStore";
import { HubDot, HubTag } from "../HubCard";
import { RepositoryScheduledTasksModal } from "../RepositoryScheduledTasksModal";
import "./index.css";

interface AutomationPanelProps {
  repositories: Repository[];
  activeRepositoryId: number | null;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph>;
}

interface RepositoryScheduleSummary {
  repository: Repository;
  tasks: RepositoryScheduledClaudeTask[];
}

function formatShortDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "暂无";
  return new Date(timestamp).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function latestExecutedAt(tasks: RepositoryScheduledClaudeTask[]): number | null {
  return tasks
    .map((task) => task.lastExecutedAt ?? 0)
    .filter((timestamp) => timestamp > 0)
    .sort((a, b) => b - a)[0] ?? null;
}

function taskTargetLabel(task: RepositoryScheduledClaudeTask, employees: EmployeeItem[]): string {
  const id = task.employeeId?.trim();
  if (!id) return "主会话";
  return employees.find((employee) => employee.id === id)?.name ?? "智能体已缺失";
}

function taskStatusTone(task: RepositoryScheduledClaudeTask): "success" | "warning" | "default" {
  if (task.lastExecuteOk === false) return "warning";
  if (task.lastExecuteOk === true) return "success";
  return "default";
}

export function AutomationPanel({
  repositories,
  activeRepositoryId,
  employees,
  workflowTemplates,
  workflowGraphsByWorkflowId,
}: AutomationPanelProps) {
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | null>(activeRepositoryId);
  const [summaries, setSummaries] = useState<RepositoryScheduleSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (activeRepositoryId != null) {
      setSelectedRepositoryId(activeRepositoryId);
    }
  }, [activeRepositoryId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await Promise.all(
        repositories.map(async (repository) => ({
          repository,
          tasks: repository.path.trim()
            ? await readRepositoryScheduledClaudeTasks(repository.path).catch(() => [])
            : [],
        })),
      );
      setSummaries(next);
    } finally {
      setLoading(false);
    }
  }, [repositories]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedSummary = useMemo(() => {
    if (selectedRepositoryId == null) return null;
    return summaries.find((item) => item.repository.id === selectedRepositoryId) ?? null;
  }, [selectedRepositoryId, summaries]);

  const visibleSummaries = summaries.length > 0
    ? summaries
    : repositories.map((repository) => ({ repository, tasks: [] }));
  const selectedRepository = selectedSummary?.repository ?? repositories.find((repo) => repo.id === selectedRepositoryId) ?? null;
  const selectedTasks = selectedSummary?.tasks ?? [];

  const repositoryOptions = repositories.map((repository) => ({
    value: repository.id,
    label: repository.name || repository.path,
  }));
  const visibleTasks = [...selectedTasks].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (b.lastExecutedAt ?? b.updatedAt ?? 0) - (a.lastExecutedAt ?? a.updatedAt ?? 0);
  }).slice(0, 5);

  return (
    <section className="app-automation-panel" aria-label="定时自动化">
      <div className="app-automation-panel__toolbar">
        <Select
          className="app-automation-panel__repo-select"
          size="small"
          placeholder="选择仓库"
          value={selectedRepositoryId ?? undefined}
          options={repositoryOptions}
          onChange={(value) => setSelectedRepositoryId(value)}
          showSearch
          optionFilterProp="label"
        />
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
          刷新
        </Button>
        <Button
          size="small"
          type="primary"
          icon={<PlayCircleOutlined />}
          disabled={!selectedRepository?.path?.trim()}
          onClick={() => setModalOpen(true)}
        >
          管理当前仓库定时任务
        </Button>
      </div>

      {visibleSummaries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可配置仓库" />
      ) : (
        <div className="app-automation-console">
          <aside className="app-automation-console__repos" aria-label="自动化仓库">
            {visibleSummaries.map(({ repository, tasks }) => {
              const enabled = tasks.filter((task) => task.enabled).length;
              const failed = tasks.filter((task) => task.lastExecuteOk === false).length;
              const selected = repository.id === selectedRepositoryId;
              return (
                <button
                  key={repository.id}
                  type="button"
                  className={`app-automation-repo-card${selected ? " app-automation-repo-card--selected" : ""}`}
                  onClick={() => setSelectedRepositoryId(repository.id)}
                >
                  <span className="app-automation-repo-card__top">
                    <strong>{repository.name || repository.path}</strong>
                    {enabled > 0 ? <HubTag tone="success">{enabled} 启用</HubTag> : <HubTag>未启用</HubTag>}
                  </span>
                  <span className="app-automation-repo-card__path">{repository.path}</span>
                  <span className="app-automation-repo-card__meta">
                    <span>
                      <CheckCircleOutlined />
                      {tasks.length} 个任务
                    </span>
                    <span className={failed > 0 ? "app-automation-repo-card__failed" : undefined}>
                      <HubDot tone={failed > 0 ? "warn" : "off"} />
                      {failed} 失败
                    </span>
                    <span>最近：{formatShortDateTime(latestExecutedAt(tasks))}</span>
                  </span>
                </button>
              );
            })}
          </aside>

          <section className="app-automation-console__detail" aria-label="当前仓库自动化">
            {selectedRepository ? (
              <>
                <div className="app-automation-console__detail-head">
                  <div>
                    <Typography.Title level={5}>{selectedRepository.name || selectedRepository.path}</Typography.Title>
                    <Typography.Text type="secondary">{selectedRepository.path}</Typography.Text>
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    disabled={!selectedRepository.path.trim()}
                    onClick={() => setModalOpen(true)}
                  >
                    编辑计划任务
                  </Button>
                </div>

                {visibleTasks.length > 0 ? (
                  <div className="app-automation-task-list">
                    {visibleTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className="app-automation-task-row"
                        onClick={() => setModalOpen(true)}
                      >
                        <span className="app-automation-task-row__main">
                          <span className="app-automation-task-row__title">
                            <HubDot tone={task.enabled ? "on" : "off"} />
                            {task.title || "未命名任务"}
                          </span>
                          <span className="app-automation-task-row__meta">
                            <code>{task.cronExpression}</code>
                            <span>{taskTargetLabel(task, employees)}</span>
                            <span>
                              <ClockCircleOutlined /> {formatShortDateTime(task.lastExecutedAt)}
                            </span>
                          </span>
                        </span>
                        <HubTag tone={taskStatusTone(task)}>
                          {task.lastExecuteOk === false ? "失败" : task.enabled ? "运行中" : "已停用"}
                        </HubTag>
                      </button>
                    ))}
                  </div>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="当前仓库暂无计划任务，点击「编辑计划任务」创建第一个自动化。"
                  />
                )}
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请选择仓库" />
            )}
          </section>
        </div>
      )}

      {selectedRepository ? (
        <RepositoryScheduledTasksModal
          open={modalOpen}
          onClose={() => {
            setModalOpen(false);
            void refresh();
          }}
          repositoryPath={selectedRepository.path}
          repositoryDisplayName={selectedRepository.name}
          employees={employees}
          workflowTemplates={workflowTemplates}
          workflowGraphsByWorkflowId={workflowGraphsByWorkflowId}
        />
      ) : null}
    </section>
  );
}
