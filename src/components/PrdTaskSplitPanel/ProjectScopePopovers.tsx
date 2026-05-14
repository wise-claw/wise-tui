import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Divider, Space, Tag, Tooltip, Typography } from "antd";
import type { EmployeeItem, ProjectItem, Repository, WorkflowTemplateItem } from "../../types";
import { repositoryOwnerBasenamesInScopeRelaxed } from "../../utils/projectPrdScopeDisplay";

interface MainOwnerDisplayGap {
  repositoryId: number;
  repoLabel: string;
  agentName: string;
}

interface ProjectTeamPopoverContentProps {
  activeProjectId: string | null;
  workflowIds: string[];
  workflowTemplates: WorkflowTemplateItem[];
  onRemoveWorkflow: (workflowId: string) => void | Promise<void>;
  onOpenLinkWorkflowModal: () => void;
}

export function ProjectTeamPopoverContent({
  activeProjectId,
  workflowIds,
  workflowTemplates,
  onRemoveWorkflow,
  onOpenLinkWorkflowModal,
}: ProjectTeamPopoverContentProps) {
  if (!activeProjectId?.trim()) {
    return <Typography.Text type="secondary">未选择项目</Typography.Text>;
  }

  return (
    <div style={{ maxWidth: 280 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        仅含本面板为项目关联的团队模板（不按单仓库存储）。
      </Typography.Paragraph>
      {workflowIds.length === 0 ? (
        <Typography.Text type="secondary">尚未配置团队</Typography.Text>
      ) : (
        <div style={{ maxHeight: 280, overflowY: "auto" }}>
          <Space orientation="vertical" size={6} style={{ width: "100%" }}>
            {workflowIds.map((id) => {
              const workflow = workflowTemplates.find((item) => item.id === id);
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Typography.Text ellipsis style={{ flex: 1, margin: 0 }}>
                    {workflow?.name ?? id}
                  </Typography.Text>
                  <Button type="link" size="small" danger onClick={() => void onRemoveWorkflow(id)}>
                    移除
                  </Button>
                </div>
              );
            })}
          </Space>
        </div>
      )}
      <Divider style={{ margin: "10px 0 6px" }} />
      <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={onOpenLinkWorkflowModal}>
        关联已有团队…
      </Button>
    </div>
  );
}

interface RepositoryScopePopoverContentProps {
  repositoryId: number;
  repositoriesById: Map<number, Repository>;
  employeesForScope: EmployeeItem[];
}

export function RepositoryScopePopoverContent({
  repositoryId,
  repositoriesById,
  employeesForScope,
}: RepositoryScopePopoverContentProps) {
  const repo = repositoriesById.get(repositoryId);
  const mainAgent = repo?.mainOwnerAgentName?.trim();
  const linkedToRepo = employeesForScope.filter((employee) => employee.repositoryIds.includes(repositoryId));

  return (
    <div style={{ maxWidth: 300 }}>
      <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
        本仓库关联员工
      </Typography.Text>
      {linkedToRepo.length === 0 ? (
        <Typography.Text type="secondary">暂无（员工配置里未勾选本仓库）</Typography.Text>
      ) : (
        <Space orientation="vertical" size={6} style={{ width: "100%" }}>
          {linkedToRepo.map((employee) => {
            const isMainOwner = Boolean(mainAgent && employee.agentType?.trim() === mainAgent);
            return (
              <div key={employee.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Typography.Text ellipsis style={{ margin: 0, flex: "1 1 auto", minWidth: 0 }}>
                  {employee.name}（{employee.agentType}）
                </Typography.Text>
                {isMainOwner ? (
                  <Tag color="blue" style={{ margin: 0 }}>
                    主 Owner
                  </Tag>
                ) : null}
              </div>
            );
          })}
        </Space>
      )}
      {mainAgent && !linkedToRepo.some((employee) => employee.agentType?.trim() === mainAgent) ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
          已配置主 Owner「{mainAgent}」，暂无关联本仓库且 agentType 与其一致的员工；请在员工配置中为该智能体勾选本仓库。
        </Typography.Text>
      ) : null}
      <Typography.Text type="secondary" style={{ display: "block", marginTop: 10, fontSize: 12 }}>
        团队模板为项目级关联，请查看顶栏「团队」。
      </Typography.Text>
    </div>
  );
}

export function ProjectEmployeePopoverTitle() {
  const tooltip = (
    <div className="app-prd-project-employee-tooltip-inner">
      <Typography.Paragraph style={{ marginBottom: 8, fontSize: 12 }}>
        此处仅列出本面板为项目<strong>显式关联</strong>的员工；不在此展示仓库侧创建或主 Owner 对应的员工。若某仓已配置主 Owner
        但尚无任何启用员工「勾选该仓库且 agentType 与其一致」，会在本弹层下方列出仓库与智能体名称。
      </Typography.Paragraph>
      <Typography.Paragraph
        className="app-prd-project-employee-tooltip-inner-muted"
        style={{ marginBottom: 0, fontSize: 12 }}
      >
        下方列出的「仓库名 · 智能体」表示该仓已在仓库侧配置主 Owner，但尚无启用员工同时勾选该仓且智能体名称与之完全一致；可在侧栏进入单仓后打开员工配置进行关联。
      </Typography.Paragraph>
    </div>
  );

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span>项目员工</span>
      <Tooltip title={tooltip} placement="bottomLeft" styles={{ root: { maxWidth: 400 } }}>
        <QuestionCircleOutlined
          aria-label="项目员工说明"
          style={{ fontSize: 14, color: "var(--ant-color-icon)", cursor: "help" }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        />
      </Tooltip>
    </span>
  );
}

interface ProjectEmployeePopoverContentProps {
  activeProjectId: string | null;
  employeeIds: string[];
  mainOwnerUnmatchedGaps: MainOwnerDisplayGap[];
  employeesForScope: EmployeeItem[];
  employees: EmployeeItem[];
  projectForHeader: ProjectItem | null;
  repositories: Repository[];
  onRemoveEmployee: (employeeId: string) => void | Promise<void>;
  onOpenLinkEmployeeModal: () => void;
}

export function ProjectEmployeePopoverContent({
  activeProjectId,
  employeeIds,
  mainOwnerUnmatchedGaps,
  employeesForScope,
  employees,
  projectForHeader,
  repositories,
  onRemoveEmployee,
  onOpenLinkEmployeeModal,
}: ProjectEmployeePopoverContentProps) {
  if (!activeProjectId?.trim()) {
    return <Typography.Text type="secondary">未选择项目</Typography.Text>;
  }

  const emptyRows = employeeIds.length === 0 && mainOwnerUnmatchedGaps.length === 0;

  return (
    <div className="app-prd-project-employee-popover-inner" style={{ maxWidth: 300 }}>
      {emptyRows ? (
        <Typography.Text type="secondary">
          暂无：可「关联已有员工」将成员加入项目，或在仓库菜单中配置主 Owner。
        </Typography.Text>
      ) : (
        <>
          {employeeIds.length > 0 ? (
            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                {employeeIds.map((id) => {
                  const employee = employeesForScope.find((item) => item.id === id) ?? employees.find((item) => item.id === id);
                  const projectRepoIds = projectForHeader?.repositoryIds ?? [];
                  const ownerBasenames =
                    employee && projectRepoIds.length > 0
                      ? repositoryOwnerBasenamesInScopeRelaxed(employee, projectRepoIds, repositories, employees)
                      : [];
                  const showOwnerBadge = ownerBasenames.length > 0;
                  return (
                    <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Typography.Text
                        ellipsis
                        style={{
                          flex: 1,
                          margin: 0,
                          minWidth: 0,
                          color: "var(--ant-color-text)",
                        }}
                      >
                        {employee?.name ?? id}
                      </Typography.Text>
                      {showOwnerBadge ? (
                        <Tag color="blue" style={{ margin: 0 }}>
                          Owner
                        </Tag>
                      ) : null}
                      <Button type="link" size="small" danger onClick={() => void onRemoveEmployee(id)}>
                        移除
                      </Button>
                    </div>
                  );
                })}
              </Space>
            </div>
          ) : null}
          {mainOwnerUnmatchedGaps.length > 0 ? (
            <div style={{ marginTop: employeeIds.length > 0 ? 6 : 0 }}>
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                {mainOwnerUnmatchedGaps.map((gap) => (
                  <div
                    key={`owner-gap-${gap.repositoryId}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                  >
                    <Typography.Text
                      ellipsis
                      style={{
                        flex: 1,
                        margin: 0,
                        minWidth: 0,
                        fontSize: 12,
                        color: "var(--ant-color-text)",
                      }}
                    >
                      {gap.repoLabel} · {gap.agentName}
                    </Typography.Text>
                    <Tag color="purple" style={{ margin: 0 }}>
                      Owner
                    </Tag>
                  </div>
                ))}
              </Space>
            </div>
          ) : null}
        </>
      )}
      <Divider style={{ margin: "6px 0 4px" }} />
      <Button type="link" size="small" style={{ padding: 0, height: "auto" }} onClick={onOpenLinkEmployeeModal}>
        关联已有员工…
      </Button>
    </div>
  );
}
