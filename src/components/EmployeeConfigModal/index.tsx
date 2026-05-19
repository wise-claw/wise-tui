import {
  BranchesOutlined,
  CheckCircleOutlined,
  CrownOutlined,
  ExclamationCircleOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { EmployeeItem, Repository, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { collectTeamMemberEmployeeIds } from "../../utils/collectTeamMemberEmployeeIds";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import {
  isEmployeeRepositoryOwnerInScopeRelaxed,
  listRepositoryMainOwnerDisplayGaps,
  repositoryOwnerBasenamesInScopeRelaxed,
  someEmployeeDisplaysMainOwnerForRepository,
  shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds,
} from "../../utils/projectPrdScopeDisplay";
import "./index.css";

type RepoOwnerGapTableRow = {
  rowKind: "repoOwnerGap";
  id: string;
  repositoryId: number;
  repoLabel: string;
  agentName: string;
};

type EmployeeConfigTableRow = EmployeeItem | RepoOwnerGapTableRow;

function isRepoOwnerGapRow(row: EmployeeConfigTableRow): row is RepoOwnerGapTableRow {
  return "rowKind" in row && row.rowKind === "repoOwnerGap";
}

interface Props {
  open: boolean;
  inline?: boolean;
  loading: boolean;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  repositories: Repository[];
  projects?: { id: string; name: string }[];
  agentTypeOptions: string[];
  defaultRepositoryIds?: number[];
  /**
   * 为 true 时（例如从需求面板按 Workspace 打开）：表格中隐藏「关联仓库全部属于 defaultRepositoryIds」的角色
   *（典型为各仓下创建的配置）；`alwaysShowEmployeeIds` 中的 id 仍会显示（如 Workspace 需求面板显式关联的成员）。
   */
  hideEmployeesAssociatedOnlyWithDefaultRepositories?: boolean;
  /** 在启用上一项过滤时，始终保留在表格中的角色 id（如 project_prd 关联）。 */
  alwaysShowEmployeeIds?: string[];
  /**
   * 从侧栏「仓库」打开：与需求面板相同展示 Owner 列与「仓库」表单项，但不关联 project_prd。
   * 须与 `hideEmployeesAssociatedOnlyWithDefaultRepositories` 同时为 true 以启用 Workspace 级表格过滤与 Owner UI。
   */
  repositoryOwnerScopeOnly?: boolean;
  /** 新建角色时默认「角色名称」（侧栏仓库流程下为仓库目录名）。 */
  initialCreateEmployeeName?: string | null;
  /**
   * 从 Workspace 上下文打开时传入单一 project id：自动归属该 Workspace 且隐藏「所属工作区」字段，避免用户误操作。
   */
  singleProjectScopeId?: string | null;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    agentType: string;
    enabled: boolean;
    repositoryIds: number[];
    projectIds?: string[];
    /** 创建后把该仓 `mainOwnerAgentName` 设为角色的 `agentType` */
    ownerRepositoryId?: number | null;
  }) => Promise<void>;
  onUpdate: (input: { employeeId: string; name: string; agentType: string; enabled: boolean; repositoryIds: number[]; projectIds?: string[] }) => Promise<void>;
  onDelete: (employeeId: string) => Promise<void>;
}

export function EmployeeConfigModal({
  open,
  inline = false,
  loading,
  employees,
  workflowTemplates,
  workflowGraphsByWorkflowId = {},
  repositories,
  projects,
  agentTypeOptions,
  defaultRepositoryIds = [],
  hideEmployeesAssociatedOnlyWithDefaultRepositories = false,
  alwaysShowEmployeeIds = [],
  repositoryOwnerScopeOnly = false,
  initialCreateEmployeeName = null,
  singleProjectScopeId = null,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);

  const editingEmployee = useMemo(
    () => employees.find((item) => item.id === editingId) ?? null,
    [employees, editingId],
  );
  const selectableAgentTypeOptions = useMemo(() => {
    const fromEmployees = employees.map((item) => item.agentType);
    const merged = Array.from(new Set([...agentTypeOptions, ...fromEmployees]));
    return merged.map((value) => ({ value, label: value }));
  }, [agentTypeOptions, employees]);
  const hideRepositorySelector = defaultRepositoryIds.length > 0;
  /** Workspace 需求面板或侧栏仓库：展示 Owner 列与「仓库」表单项 */
  const projectOwnerPickMode =
    defaultRepositoryIds.length > 0 &&
    (hideEmployeesAssociatedOnlyWithDefaultRepositories || repositoryOwnerScopeOnly);
  const singleOwnerRepositoryId =
    repositoryOwnerScopeOnly && defaultRepositoryIds.length === 1 ? defaultRepositoryIds[0] : undefined;
  const teamEmployeeIds = useMemo(
    () => collectTeamMemberEmployeeIds(workflowTemplates, workflowGraphsByWorkflowId),
    [workflowTemplates, workflowGraphsByWorkflowId],
  );

  const alwaysShowEmployeeIdSet = useMemo(
    () => new Set((alwaysShowEmployeeIds ?? []).map((id) => id.trim()).filter(Boolean)),
    [alwaysShowEmployeeIds],
  );

  const tableEmployees = useMemo(() => {
    if (!hideEmployeesAssociatedOnlyWithDefaultRepositories || defaultRepositoryIds.length === 0) {
      return employees;
    }
    return employees.filter((e) => {
      if (alwaysShowEmployeeIdSet.has(e.id)) return true;
      if (isEmployeeRepositoryOwnerInScopeRelaxed(e, defaultRepositoryIds, repositories, employees)) return true;
      return !shouldHideEmployeeAssociatedOnlyWithDefaultRepositoryIds(e, defaultRepositoryIds);
    });
  }, [
    employees,
    defaultRepositoryIds,
    hideEmployeesAssociatedOnlyWithDefaultRepositories,
    alwaysShowEmployeeIdSet,
    repositories,
  ]);

  const repoOwnerGapRows = useMemo((): RepoOwnerGapTableRow[] => {
    if (!projectOwnerPickMode) return [];
    const gaps = listRepositoryMainOwnerDisplayGaps(repositories, employees).filter((g) =>
      defaultRepositoryIds.includes(g.repositoryId),
    );
    return gaps
      .filter(
        (g) =>
          !someEmployeeDisplaysMainOwnerForRepository(
            g.repositoryId,
            defaultRepositoryIds,
            repositories,
            employees,
          ),
      )
      .map((g) => ({
        rowKind: "repoOwnerGap" as const,
        id: `__repo_owner_gap__:${g.repositoryId}`,
        repositoryId: g.repositoryId,
        repoLabel: g.repoLabel,
        agentName: g.agentName,
      }));
  }, [projectOwnerPickMode, repositories, employees, defaultRepositoryIds]);

  const scopedRepositoryIds = useMemo(
    () => (defaultRepositoryIds.length > 0 ? defaultRepositoryIds : repositories.map((repository) => repository.id)),
    [defaultRepositoryIds, repositories],
  );
  const scopedRepositoryIdSet = useMemo(() => new Set(scopedRepositoryIds), [scopedRepositoryIds]);
  const scopedRepositories = useMemo(
    () => repositories.filter((repository) => scopedRepositoryIdSet.has(repository.id)),
    [repositories, scopedRepositoryIdSet],
  );
  const enabledEmployees = useMemo(
    () => employees.filter((employee) => employee.enabled),
    [employees],
  );
  const activeTeamMemberCount = useMemo(
    () => enabledEmployees.filter((employee) => teamEmployeeIds.has(employee.id)).length,
    [enabledEmployees, teamEmployeeIds],
  );
  const scopedOwnerGapCount = useMemo(
    () => listRepositoryMainOwnerDisplayGaps(scopedRepositories, employees).length,
    [scopedRepositories, employees],
  );
  const scopedOwnerConfiguredCount = useMemo(
    () => scopedRepositories.filter((repository) => repository.mainOwnerAgentName?.trim()).length,
    [scopedRepositories],
  );
  const workflowStageCount = useMemo(
    () => workflowTemplates.reduce((total, template) => total + template.stages.length, 0),
    [workflowTemplates],
  );
  const disabledEmployeeCount = employees.length - enabledEmployees.length;

  const tableDataSource = useMemo(
    (): EmployeeConfigTableRow[] => [...tableEmployees, ...repoOwnerGapRows],
    [tableEmployees, repoOwnerGapRows],
  );

  function handleCreateClick() {
    setEditingId(null);
    form.setFieldsValue({
      name: initialCreateEmployeeName?.trim() ?? "",
      agentType: "executor",
      repositoryIds: defaultRepositoryIds,
      projectIds: singleProjectScopeId ? [singleProjectScopeId] : undefined,
      ownerRepositoryId: singleOwnerRepositoryId ?? undefined,
    });
  }

  useEffect(() => {
    if (!open || editingId) return;
    if (!repositoryOwnerScopeOnly || !initialCreateEmployeeName?.trim()) return;
    form.setFieldsValue({
      name: initialCreateEmployeeName.trim(),
      agentType: "executor",
      repositoryIds: defaultRepositoryIds,
      projectIds: singleProjectScopeId ? [singleProjectScopeId] : undefined,
      ownerRepositoryId: singleOwnerRepositoryId ?? undefined,
    });
  }, [
    open,
    editingId,
    repositoryOwnerScopeOnly,
    initialCreateEmployeeName,
    defaultRepositoryIds,
    singleOwnerRepositoryId,
    singleProjectScopeId,
    form,
  ]);

  async function handleSubmit() {
    try {
      const values = await form.validateFields(["name", "agentType"]);
      if (editingEmployee) {
        const nextRepositoryIds =
          hideRepositorySelector ? editingEmployee.repositoryIds : (values.repositoryIds ?? defaultRepositoryIds);
        await onUpdate({
          employeeId: editingEmployee.id,
          name: values.name,
          agentType: values.agentType,
          enabled: editingEmployee.enabled,
          repositoryIds: nextRepositoryIds,
          projectIds: values.projectIds ?? editingEmployee.projectIds,
        });
        return;
      }
      if (projectOwnerPickMode) {
        const ownerRid =
          (values.ownerRepositoryId as number | undefined) ??
          defaultRepositoryIds[0];
        if (ownerRid == null) {
          message.error("缺少 Owner 仓库");
          return;
        }
        await onCreate({
          name: values.name,
          agentType: values.agentType,
          enabled: true,
          repositoryIds: [ownerRid],
          ownerRepositoryId: ownerRid,
        });
        form.setFieldsValue({
          name: "",
          agentType: "executor",
          ownerRepositoryId: undefined,
          repositoryIds: defaultRepositoryIds,
        });
        return;
      }
      const selectedRepositoryIds: number[] = values.repositoryIds ?? defaultRepositoryIds;
      const mergedRepositoryIds = Array.from(new Set([...defaultRepositoryIds, ...selectedRepositoryIds]));
      await onCreate({ name: values.name, agentType: values.agentType, enabled: true, repositoryIds: mergedRepositoryIds });
      form.setFieldsValue({ name: "", agentType: "executor", repositoryIds: defaultRepositoryIds });
    } catch (error) {
      console.error("handleSubmit error:", error);
      if (error instanceof Error) {
        message.error(error.message);
      }
    }
  }

  async function handleToggleEnabled(row: EmployeeItem, enabled: boolean) {
    await onUpdate({
      employeeId: row.id,
      name: row.name,
      agentType: row.agentType,
      enabled,
      repositoryIds: row.repositoryIds,
      projectIds: row.projectIds,
    });
  }

  const content = (
    <Space orientation="vertical" size={10} className="app-employee-config-modal">
        <section className="app-employee-config-hero" aria-label="智能体角色控制台">
          <div>
            <Typography.Text className="app-employee-config-hero__eyebrow">
              智能体角色供给
            </Typography.Text>
            <Typography.Title level={4} className="app-employee-config-hero__title">
              智能体角色控制台
            </Typography.Title>
            <Typography.Paragraph className="app-employee-config-hero__subtitle">
              集中管理可被负责人委派的智能体角色、仓库主 Owner 和委派协议成员。原有员工配置能力保留，
              但统一收敛成角色供给层。
            </Typography.Paragraph>
          </div>
          <div className="app-employee-config-hero__meter">
            <strong>{enabledEmployees.length}/{employees.length}</strong>
            <span>可用角色</span>
          </div>
        </section>

        <div className="app-employee-config-summary" aria-label="智能体角色状态">
          <TeamRoleMetric icon={<TeamOutlined />} label="启用角色" value={enabledEmployees.length} />
          <TeamRoleMetric icon={<BranchesOutlined />} label="参与委派协议" value={activeTeamMemberCount} />
          <TeamRoleMetric icon={<CrownOutlined />} label="仓库 Owner" value={scopedOwnerConfiguredCount} />
          <TeamRoleMetric
            icon={scopedOwnerGapCount > 0 || disabledEmployeeCount > 0 ? <ExclamationCircleOutlined /> : <CheckCircleOutlined />}
            label="待处理项"
            value={scopedOwnerGapCount + disabledEmployeeCount}
            tone={scopedOwnerGapCount > 0 || disabledEmployeeCount > 0 ? "danger" : "default"}
          />
        </div>

        <div className="app-employee-config-map" aria-label="智能体角色供给闭环">
          <TeamRoleSupplyItem
            icon={<TeamOutlined />}
            title="角色供给"
            status="可编辑"
            description={`${employees.length} 个角色集中管理；名称、启用态、关联仓库和工作区归属保留原有配置能力`}
          />
          <TeamRoleSupplyItem
            icon={<ThunderboltOutlined />}
            title="执行引擎"
            status="已绑定"
            description={`${agentTypeOptions.length} 个可选智能体名称；角色通过智能体名称绑定 Claude、Codex 或自定义命令`}
          />
          <TeamRoleSupplyItem
            icon={<CrownOutlined />}
            title="共享工作区"
            status="Owner"
            description={`${scopedRepositories.length} 个仓库在当前作用域内；Owner 决定默认主执行角色，缺口会显式标出`}
          />
          <TeamRoleSupplyItem
            icon={<BranchesOutlined />}
            title="委派分发"
            status="协议驱动"
            description={`${workflowTemplates.length} 个模板 · ${workflowStageCount} 个阶段；委派协议负责把阶段派发给角色`}
          />
        </div>

        <Form
          form={form}
          layout="inline"
          size="small"
          initialValues={{
            name: "",
            agentType: "executor",
            repositoryIds: defaultRepositoryIds,
            ownerRepositoryId: undefined,
          }}
          className={`app-employee-config-form${projectOwnerPickMode ? " app-employee-config-form--project-owner" : ""}`}
        >
          <div
            className={`app-employee-config-row ${
              projectOwnerPickMode
                ? "app-employee-config-row--project-owner"
                : hideRepositorySelector
                  ? "app-employee-config-row--compact"
                  : ""
            }`}
          >
            {projects && projects.length > 0 && !repositoryOwnerScopeOnly && !singleProjectScopeId ? (
              <div className="app-employee-config-field">
                <div className="app-employee-config-field-label">所属工作区</div>
                <Form.Item
                  name="projectIds"
                  className="app-employee-config-item app-employee-config-item--projects"
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="所属工作区"
                    maxTagCount="responsive"
                    options={projects.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                  />
                </Form.Item>
              </div>
            ) : null}
            {(!hideRepositorySelector || repositoryOwnerScopeOnly) ? (
              <div className="app-employee-config-field">
                <div className="app-employee-config-field-label">关联仓库</div>
                <Form.Item
                  name="repositoryIds"
                  className="app-employee-config-item app-employee-config-item--repositories"
                >
                  <Select
                    mode="multiple"
                    allowClear={repositoryOwnerScopeOnly ? false : true}
                    placeholder="关联仓库"
                    maxTagCount="responsive"
                    disabled={repositoryOwnerScopeOnly}
                    options={repositories.map((repository) => ({
                      value: repository.id,
                      label: repositoryFolderBasename(repository),
                    }))}
                  />
                </Form.Item>
              </div>
            ) : null}
            <div className="app-employee-config-field">
              <div className="app-employee-config-field-label">角色名称</div>
              <Form.Item
                name="name"
                rules={[{ required: true, message: "请输入角色名称" }]}
                className="app-employee-config-item app-employee-config-item--name"
              >
                <Input placeholder="Agent 角色名称" allowClear />
              </Form.Item>
            </div>
            <div className="app-employee-config-field">
              <div className="app-employee-config-field-label">智能体</div>
              <Form.Item
                name="agentType"
                rules={[{ required: true, message: "请输入智能体" }]}
                className="app-employee-config-item app-employee-config-item--agent"
              >
                <Select
                  showSearch
                  placeholder="选择智能体"
                  options={selectableAgentTypeOptions}
                  optionFilterProp="label"
                  popupMatchSelectWidth={false}
                />
              </Form.Item>
            </div>
            <div className="app-employee-config-actions">
              <Button size="small" type="primary" loading={loading} onClick={() => void handleSubmit()}>
                {editingEmployee ? "保存角色" : "新增角色"}
              </Button>
              {editingEmployee ? <Button size="small" onClick={handleCreateClick}>取消编辑</Button> : null}
            </div>
            {projectOwnerPickMode && !editingEmployee && !singleOwnerRepositoryId ? (
              <div className="app-employee-config-field">
                <div className="app-employee-config-field-label" title="作为该仓唯一主 Owner 的新角色将关联此仓库">
                  仓库
                </div>
                <Form.Item
                  name="ownerRepositoryId"
                  className="app-employee-config-item app-employee-config-item--owner-repo"
                >
                  <Select
                    allowClear
                    showSearch
                    placeholder="选择仓库（每仓仅 1 名 Owner）"
                    optionFilterProp="label"
                    popupMatchSelectWidth={false}
                    options={defaultRepositoryIds.map((id) => {
                      const repository = repositories.find((r) => r.id === id);
                      const labelBase = repository ? repositoryFolderBasename(repository) : `仓库 #${id}`;
                      const taken = Boolean(repository?.mainOwnerAgentName?.trim());
                      return {
                        value: id,
                        label: taken ? `${labelBase}（已有 Owner）` : labelBase,
                        disabled: taken,
                      };
                    })}
                  />
                </Form.Item>
              </div>
            ) : null}
          </div>
        </Form>
        <Table<EmployeeConfigTableRow>
          rowKey={(r) => r.id}
          loading={loading}
          dataSource={tableDataSource}
          pagination={false}
          className="app-employee-config-table"
          columns={[
            {
              title: "角色",
              key: "name",
              render: (_, row) => {
                if (isRepoOwnerGapRow(row)) {
                  return (
                    <Space size={4} wrap>
                      <Typography.Text ellipsis={{ tooltip: row.repoLabel }}>{row.repoLabel}</Typography.Text>
                      <Tag className="app-employee-config-owner-tag">仅仓库</Tag>
                    </Space>
                  );
                }
                return row.name;
              },
            },
            {
              title: "智能体",
              key: "agentType",
              render: (_, row) => (isRepoOwnerGapRow(row) ? row.agentName : row.agentType),
            },
            ...(projectOwnerPickMode
              ? [
                  {
                    title: "Owner 标识",
                    key: "ownerScope",
                    render: (_: unknown, row: EmployeeConfigTableRow) => {
                      if (isRepoOwnerGapRow(row)) {
                        return (
                          <Tag color="purple" className="app-employee-config-owner-tag">
                            主 Owner
                          </Tag>
                        );
                      }
                      const names = repositoryOwnerBasenamesInScopeRelaxed(
                        row,
                        defaultRepositoryIds,
                        repositories,
                        employees,
                      );
                      if (names.length === 0) return "—";
                      return (
                        <Tag color="blue" className="app-employee-config-owner-tag">
                          Owner
                        </Tag>
                      );
                    },
                  },
                ]
              : []),
            {
              title: "编排状态",
              key: "teamMember",
              render: (_, row) => {
                if (isRepoOwnerGapRow(row)) return "—";
                return teamEmployeeIds.has(row.id) ? <Tag color="processing">已编排</Tag> : <Tag>待编排</Tag>;
              },
            },
            {
              title: "状态",
              key: "enabled",
              render: (_: unknown, row) => {
                if (isRepoOwnerGapRow(row)) {
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      —
                    </Typography.Text>
                  );
                }
                return (
                  <Switch
                    size="small"
                    checked={row.enabled}
                    checkedChildren="启用"
                    unCheckedChildren="禁用"
                    loading={loading}
                    onChange={(next) => {
                      void handleToggleEnabled(row, next);
                    }}
                  />
                );
              },
            },
            {
              title: "操作",
              key: "actions",
              render: (_, row) => {
                if (isRepoOwnerGapRow(row)) {
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }} ellipsis={{ tooltip: "在侧栏进入单个仓库后打开智能体角色，可为角色关联仓库" }}>
                      在单仓智能体角色中关联仓库
                    </Typography.Text>
                  );
                }
                return (
                  <Space size={8}>
                    <Button
                      size="small"
                      onClick={() => {
                        setEditingId(row.id);
                        form.setFieldsValue({
                          name: row.name,
                          agentType: row.agentType,
                          repositoryIds: row.repositoryIds,
                          projectIds: row.projectIds,
                          ownerRepositoryId: undefined,
                        });
                      }}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除该角色？"
                      onConfirm={() => onDelete(row.id)}
                      okText="删除"
                      cancelText="取消"
                    >
                      <Button size="small" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
        {hideEmployeesAssociatedOnlyWithDefaultRepositories && defaultRepositoryIds.length > 0
        && !repositoryOwnerScopeOnly ? (
          <Typography.Text type="secondary" className="app-employee-config-footnote">
            已从本表隐藏「仅关联当前 Workspace 内仓库」的角色（一般为各仓侧创建的配置）；Workspace 需求面板显式关联的成员、以及在本 Workspace 内仓上配置为主 Owner 的角色仍会显示。若某仓仅在仓库侧配置了主 Owner、且尚未与任何角色关联，将以「仅仓库」行展示。在侧栏进入单个仓库打开智能体角色可查看与编辑全部角色。
          </Typography.Text>
        ) : null}
        {repositoryOwnerScopeOnly && defaultRepositoryIds.length > 0 ? (
          <Typography.Text type="secondary" className="app-employee-config-footnote">
            从侧栏仓库打开：新建时默认角色名称为该仓库目录名；保存后会自动勾选本仓库并写入仓库主 Owner，表格中「Owner 标识」列与 Workspace 需求面板规则一致。
          </Typography.Text>
        ) : null}
    </Space>
  );

  if (inline) {
    if (!open) return null;
    return <div className="app-employee-config-inline-root">{content}</div>;
  }

  return (
    <Modal
      title="智能体角色"
      open={open}
      onCancel={onClose}
      footer={null}
      width={projectOwnerPickMode ? 850 : 780}
      destroyOnHidden
      rootClassName="app-employee-config-modal-root"
    >
      {content}
    </Modal>
  );
}

interface TeamRoleMetricProps {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "default" | "danger";
}

function TeamRoleMetric({ icon, label, value, tone = "default" }: TeamRoleMetricProps) {
  return (
    <div className={`app-employee-config-metric${tone === "danger" ? " app-employee-config-metric--danger" : ""}`}>
      <span className="app-employee-config-metric__icon" aria-hidden>
        {icon}
      </span>
      <span>
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

interface TeamRoleSupplyItemProps {
  icon: ReactNode;
  title: string;
  status: string;
  description: string;
}

function TeamRoleSupplyItem({ icon, title, status, description }: TeamRoleSupplyItemProps) {
  return (
    <div className="app-employee-config-supply">
      <span className="app-employee-config-supply__icon" aria-hidden>
        {icon}
      </span>
      <span>
        <span className="app-employee-config-supply__head">
          <strong>{title}</strong>
          <Tag color="processing">{status}</Tag>
        </span>
        <small>{description}</small>
      </span>
    </div>
  );
}
