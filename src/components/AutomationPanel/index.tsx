import {
  CheckCircleOutlined,
  CloseOutlined,
  FieldTimeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Select, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { EmployeeItem, Repository, RepositoryScheduledClaudeTask, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { readRepositoryScheduledClaudeTasks } from "../../services/repositoryScheduledClaudeTasksStore";
import { AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import { RepositoryScheduledTasksModal } from "../RepositoryScheduledTasksModal";
import "./index.css";

interface AutomationPanelProps {
  repositories: Repository[];
  activeRepositoryId: number | null;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId: Record<string, WorkflowGraph>;
  /** 关闭定时自动化页（例如 Cockpit 叠层返回助手）。 */
  onClose?: () => void;
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

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 55%), hsl(${h2}, 70%, 45%))`;
}

function getInitials(name: string): string {
  const clean = name.split(/[\\/]/).pop() || name;
  const parts = clean.split(/[-_\s]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0]! + parts[1][0]!).toUpperCase();
  }
  return clean.substring(0, 2).toUpperCase();
}

export function AutomationPanel({
  repositories,
  activeRepositoryId,
  employees,
  workflowTemplates,
  workflowGraphsByWorkflowId,
  onClose,
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

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element) {
        if (
          target.closest(
            ".ant-modal-wrap, .ant-drawer-open, .ant-select-dropdown, .ant-dropdown, .ant-popover",
          )
        ) {
          return;
        }
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectedSummary = useMemo(() => {
    if (selectedRepositoryId == null) return null;
    return summaries.find((item) => item.repository.id === selectedRepositoryId) ?? null;
  }, [selectedRepositoryId, summaries]);

  const visibleSummaries = summaries.length > 0
    ? summaries
    : repositories.map((repository) => ({ repository, tasks: [] }));
  const selectedRepository = selectedSummary?.repository ?? repositories.find((repo) => repo.id === selectedRepositoryId) ?? null;

  const repositoryOptions = repositories.map((repository) => ({
    value: repository.id,
    label: repository.name || repository.path,
  }));
  const openRepositoryTasks = useCallback((repositoryId: number) => {
    setSelectedRepositoryId(repositoryId);
    setModalOpen(true);
  }, []);

  const panel = (
    <AuthorPanelPageShell
      className="app-automation-panel"
      icon={<FieldTimeOutlined />}
      title="定时自动化"
      subtitle="Cron、Mission 和会话续跑"
      actions={
        <>
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
          管理定时任务
        </Button>
        </>
      }
    >
      {visibleSummaries.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无可配置仓库" />
      ) : (
        <div className="app-automation-console__repos" aria-label="自动化仓库">
          {visibleSummaries.map(({ repository, tasks }) => {
            const enabled = tasks.filter((task) => task.enabled).length;
            const failed = tasks.filter((task) => task.lastExecuteOk === false).length;
            const selected = repository.id === selectedRepositoryId;
            const name = repository.name || repository.path;
            return (
              <button
                key={repository.id}
                type="button"
                className={`app-automation-repo-card${selected ? " app-automation-repo-card--selected" : ""}`}
                onClick={() => openRepositoryTasks(repository.id)}
                style={{ "--repo-gradient": getAvatarGradient(name) } as React.CSSProperties}
              >
                <div className="app-automation-repo-card__avatar-wrap">
                  <div className="app-automation-repo-card__avatar">
                    {getInitials(name)}
                  </div>
                </div>
                <div className="app-automation-repo-card__content">
                  <div className="app-automation-repo-card__top">
                    <strong title={name}>{name}</strong>
                    {enabled > 0 ? (
                      <span className="app-automation-repo-card__status-badge app-automation-repo-card__status-badge--enabled">
                        <span className="app-automation-repo-card__pulse-dot app-automation-repo-card__pulse-dot--success" />
                        {enabled} 启用
                      </span>
                    ) : (
                      <span className="app-automation-repo-card__status-badge app-automation-repo-card__status-badge--disabled">
                        未启用
                      </span>
                    )}
                  </div>
                  <div className="app-automation-repo-card__path-wrap">
                    <code className="app-automation-repo-card__path" title={repository.path}>
                      {repository.path}
                    </code>
                  </div>
                  <div className="app-automation-repo-card__meta">
                    <span className="app-automation-repo-card__meta-item">
                      <CheckCircleOutlined className="app-automation-repo-card__meta-icon" />
                      {tasks.length} 个任务
                    </span>
                    <span className={`app-automation-repo-card__meta-item ${failed > 0 ? "app-automation-repo-card__meta-item--failed" : ""}`}>
                      {failed > 0 ? (
                        <>
                          <span className="app-automation-repo-card__pulse-dot app-automation-repo-card__pulse-dot--failed" />
                          {failed} 失败
                        </>
                      ) : (
                        <>
                          <span className="app-automation-repo-card__pulse-dot app-automation-repo-card__pulse-dot--off" />
                          0 失败
                        </>
                      )}
                    </span>
                    <span className="app-automation-repo-card__meta-item app-automation-repo-card__meta-item--recent">
                      最近: {formatShortDateTime(latestExecutedAt(tasks))}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
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
    </AuthorPanelPageShell>
  );

  if (!onClose) {
    return panel;
  }

  return (
    <div className="app-automation-panel-root app-automation-panel-root--closable">
      <div className="app-automation-panel__titlebar">
        <div className="app-automation-panel__titlebar-drag" data-tauri-drag-region aria-hidden />
        <Tooltip title="关闭" mouseEnterDelay={0.35}>
          <Button
            type="text"
            size="small"
            className="app-automation-panel__close-btn"
            icon={<CloseOutlined />}
            aria-label="关闭"
            onClick={onClose}
          />
        </Tooltip>
      </div>
      {panel}
    </div>
  );
}
