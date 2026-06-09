import {
  CloseOutlined,
  PlusOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Button,
  Popover,
  Space,
  Tag,
  Typography,
} from "antd";
import { useMemo } from "react";
import { HoverHint } from "../shared/HoverHint";
import type { EmployeeItem, ProjectItem, Repository, WorkflowTemplateItem } from "../../types";
import { isOmcMonitorEmployeeRecord } from "../../utils/omcMonitorEmployeeSession";
import { listRepositoryMainOwnerDisplayGaps } from "../../utils/projectPrdScopeDisplay";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import { ProjectPrdScopeLinkModal } from "./ProjectPrdScopeLinkModal";
import {
  ProjectEmployeePopoverContent,
  ProjectEmployeePopoverTitle,
  ProjectTeamPopoverContent,
  RepositoryScopePopoverContent,
} from "./ProjectScopePopovers";
import { useProjectPrdScopeLinks } from "./useProjectPrdScopeLinks";

interface HeaderRepositoryTagItem {
  key: string;
  label: string;
  repositoryId: number;
  hasMainOwner: boolean;
}

interface Props {
  projects: ProjectItem[];
  repositories: Repository[];
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  activeProjectId: string | null;
  linkedProject: ProjectItem | null;
  linkedRepositoryId: number | null;
  linkedRepository: Repository | null;
  closingActive: boolean;
  onClose: () => void;
  onOpenEmployeeConfigForProject?: () => void;
  onOpenWorkflowConfigForProject?: () => void;
}

export function ProjectScopeHeader({
  projects,
  repositories,
  employees,
  workflowTemplates,
  activeProjectId,
  linkedProject,
  linkedRepositoryId,
  linkedRepository,
  closingActive,
  onClose,
  onOpenEmployeeConfigForProject,
  onOpenWorkflowConfigForProject,
}: Props) {
  const {
    closeProjectPrdLinkModal,
    handleConfirmProjectPrdLinkExisting,
    linkOptions,
    openProjectPrdLinkEmployeeModal,
    openProjectPrdLinkWorkflowModal,
    projectPrdEmployeeIds,
    projectPrdLinkKind,
    projectPrdLinkModalOpen,
    projectPrdLinkSaving,
    projectPrdLinkSelection,
    projectPrdScopeLoading,
    projectPrdWorkflowIds,
    removeProjectEmployeeFromPrd,
    removeProjectWorkflowFromPrd,
    setProjectPrdLinkSelection,
  } = useProjectPrdScopeLinks({
    activeProjectId,
    employees,
    workflowTemplates,
  });

  const repositoriesById = useMemo(
    () => new Map(repositories.map((repository) => [repository.id, repository])),
    [repositories],
  );

  const projectForHeader = useMemo(
    () => linkedProject ?? (activeProjectId ? projects.find((p) => p.id === activeProjectId) ?? null : null),
    [linkedProject, activeProjectId, projects],
  );

  const headerProjectName = useMemo(() => projectForHeader?.name?.trim() || null, [projectForHeader]);

  const headerRepositoryTagItems = useMemo<HeaderRepositoryTagItem[]>(() => {
    if (projectForHeader) {
      return projectForHeader.repositoryIds
        .map((id) => {
          const r = repositoriesById.get(id);
          if (!r) return null;
          const label = repositoryFolderBasename(r).trim();
          if (!label) return null;
          return {
            key: String(id),
            label,
            repositoryId: id,
            hasMainOwner: Boolean(r.mainOwnerAgentName?.trim()),
          };
        })
        .filter((x): x is HeaderRepositoryTagItem => x != null);
    }
    if (linkedRepositoryId != null && linkedRepository) {
      const label = repositoryFolderBasename(linkedRepository).trim();
      if (label) {
        return [
          {
            key: String(linkedRepositoryId),
            label,
            repositoryId: linkedRepositoryId,
            hasMainOwner: Boolean(linkedRepository.mainOwnerAgentName?.trim()),
          },
        ];
      }
    }
    return [];
  }, [projectForHeader, linkedRepositoryId, linkedRepository, repositoriesById]);

  const projectHeaderRepositories = useMemo(() => {
    if (!projectForHeader) return [];
    return projectForHeader.repositoryIds
      .map((id) => repositoriesById.get(id))
      .filter((r): r is Repository => Boolean(r));
  }, [projectForHeader, repositoriesById]);

  const employeesForPrdHeaderScope = useMemo(
    () => employees.filter((e) => e.enabled && !isOmcMonitorEmployeeRecord(e)),
    [employees],
  );

  const projectMainOwnerUnmatchedGaps = useMemo(
    () => listRepositoryMainOwnerDisplayGaps(projectHeaderRepositories, employeesForPrdHeaderScope),
    [projectHeaderRepositories, employeesForPrdHeaderScope],
  );

  const projectEmployeeHeaderBadgeCount = useMemo(
    () => projectPrdEmployeeIds.length + projectMainOwnerUnmatchedGaps.length,
    [projectPrdEmployeeIds, projectMainOwnerUnmatchedGaps],
  );

  return (
    <>
      <ProjectPrdScopeLinkModal
        open={projectPrdLinkModalOpen}
        kind={projectPrdLinkKind}
        saving={projectPrdLinkSaving}
        selection={projectPrdLinkSelection}
        options={linkOptions}
        onCancel={closeProjectPrdLinkModal}
        onChange={setProjectPrdLinkSelection}
        onConfirm={() => void handleConfirmProjectPrdLinkExisting()}
      />
      <Space className="app-prd-task-panel__header" align="start">
        <div className="app-prd-task-panel__header-summary-wrap" style={{ minWidth: 0, flex: 1 }}>
          {headerProjectName || headerRepositoryTagItems.length > 0 || activeProjectId?.trim() ? (
            <div className="app-prd-task-panel__header-summary-project">
              <Space
                wrap
                size={[6, 4]}
                align="center"
                className="app-prd-task-panel__header-summary-project-inner"
              >
                {headerProjectName ? (
                  <Typography.Text type="secondary" className="app-prd-task-panel__header-project-line">
                    项目：{headerProjectName}
                  </Typography.Text>
                ) : null}
                <Space size={4} wrap align="center" className="app-prd-task-panel__header-project-scope">
                  <div className="app-prd-task-panel__header-scope-split">
                    <div className="app-prd-task-panel__header-scope-split__trigger-wrap">
                      <Popover
                        title={<ProjectEmployeePopoverTitle />}
                        trigger="click"
                        content={
                          <ProjectEmployeePopoverContent
                            activeProjectId={activeProjectId}
                            employeeIds={projectPrdEmployeeIds}
                            mainOwnerUnmatchedGaps={projectMainOwnerUnmatchedGaps}
                            employeesForScope={employeesForPrdHeaderScope}
                            employees={employees}
                            projectForHeader={projectForHeader}
                            repositories={repositories}
                            onRemoveEmployee={removeProjectEmployeeFromPrd}
                            onOpenLinkEmployeeModal={openProjectPrdLinkEmployeeModal}
                          />
                        }
                        rootClassName="app-prd-project-employee-popover"
                      >
                        <Button
                          size="small"
                          type="default"
                          icon={<UserOutlined />}
                          disabled={!activeProjectId?.trim()}
                          loading={projectPrdScopeLoading}
                          className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__main"
                        >
                          员工（{projectEmployeeHeaderBadgeCount}）
                        </Button>
                      </Popover>
                    </div>
                    <span className="app-prd-task-panel__header-scope-split__divider" aria-hidden />
                    <div className="app-prd-task-panel__header-scope-split__addon-wrap">
                      <HoverHint title="新增员工（与仓库配置一致）">
                        <Button
                          size="small"
                          type="default"
                          icon={<PlusOutlined />}
                          disabled={!activeProjectId?.trim()}
                          aria-label="新增员工"
                          className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__addon"
                          onClick={() => onOpenEmployeeConfigForProject?.()}
                        />
                      </HoverHint>
                    </div>
                  </div>
                  <div className="app-prd-task-panel__header-scope-split">
                    <div className="app-prd-task-panel__header-scope-split__trigger-wrap">
                      <Popover
                        title="项目团队（本面板关联）"
                        trigger="click"
                        content={
                          <ProjectTeamPopoverContent
                            activeProjectId={activeProjectId}
                            workflowIds={projectPrdWorkflowIds}
                            workflowTemplates={workflowTemplates}
                            onRemoveWorkflow={removeProjectWorkflowFromPrd}
                            onOpenLinkWorkflowModal={openProjectPrdLinkWorkflowModal}
                          />
                        }
                      >
                        <Button
                          size="small"
                          type="default"
                          icon={<TeamOutlined />}
                          disabled={!activeProjectId?.trim()}
                          loading={projectPrdScopeLoading}
                          className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__main"
                        >
                          团队（{projectPrdWorkflowIds.length}）
                        </Button>
                      </Popover>
                    </div>
                    <span className="app-prd-task-panel__header-scope-split__divider" aria-hidden />
                    <div className="app-prd-task-panel__header-scope-split__addon-wrap">
                      <HoverHint title="新增团队（与仓库配置一致）">
                        <Button
                          size="small"
                          type="default"
                          icon={<PlusOutlined />}
                          disabled={!activeProjectId?.trim()}
                          aria-label="新增团队"
                          className="app-prd-task-panel__requirement-op-btn app-prd-task-panel__header-scope-split__addon"
                          onClick={() => onOpenWorkflowConfigForProject?.()}
                        />
                      </HoverHint>
                    </div>
                  </div>
                </Space>
                {headerRepositoryTagItems.map((item) => (
                  <Popover
                    key={item.key}
                    title={`仓库：${item.label}`}
                    trigger="click"
                    content={
                      <RepositoryScopePopoverContent
                        repositoryId={item.repositoryId}
                        repositoriesById={repositoriesById}
                        employeesForScope={employeesForPrdHeaderScope}
                      />
                    }
                  >
                    <span className="app-prd-task-panel__header-repo-tag-wrap">
                      <Tag className="app-prd-task-panel__header-repo-tag app-prd-task-panel__header-repo-tag--interactive" variant="filled">
                        {item.label}
                      </Tag>
                      {item.hasMainOwner ? (
                        <span
                          className="app-prd-task-panel__header-repo-tag-owner-mark"
                          aria-label="已配置主 Owner"
                          title="已配置主 Owner"
                        >
                          <UserOutlined />
                        </span>
                      ) : null}
                    </span>
                  </Popover>
                ))}
                {headerProjectName && headerRepositoryTagItems.length === 0 ? (
                  <Tag className="app-prd-task-panel__header-repo-tag" variant="filled">
                    暂无仓库
                  </Tag>
                ) : null}
              </Space>
            </div>
          ) : null}
        </div>
        <Space className="app-prd-task-panel__header-actions">
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={onClose}
            aria-label="关闭需求面板"
            disabled={closingActive}
          />
        </Space>
      </Space>
    </>
  );
}
