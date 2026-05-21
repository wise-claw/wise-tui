import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
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

function getAvatarStyle(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return {
    backgroundColor: `hsl(${h}, 60%, 42%)`,
  };
}

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2);
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
  const [formModalOpen, setFormModalOpen] = useState(false);
  const autoOpenedCreateRef = useRef(false);

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

  const tableDataSource = useMemo(
    (): EmployeeConfigTableRow[] => [...tableEmployees, ...repoOwnerGapRows],
    [tableEmployees, repoOwnerGapRows],
  );

  function resetCreateFormValues() {
    form.setFieldsValue({
      name: initialCreateEmployeeName?.trim() ?? "",
      agentType: "executor",
      repositoryIds: defaultRepositoryIds,
      projectIds: singleProjectScopeId ? [singleProjectScopeId] : undefined,
      ownerRepositoryId: singleOwnerRepositoryId ?? undefined,
    });
  }

  function openCreateFormModal() {
    setEditingId(null);
    resetCreateFormValues();
    setFormModalOpen(true);
  }

  function openEditFormModal(employee: EmployeeItem) {
    setEditingId(employee.id);
    form.setFieldsValue({
      name: employee.name,
      agentType: employee.agentType,
      repositoryIds: employee.repositoryIds,
      projectIds: employee.projectIds,
      ownerRepositoryId: undefined,
    });
    setFormModalOpen(true);
  }

  function closeFormModal() {
    setFormModalOpen(false);
    setEditingId(null);
    form.resetFields();
    resetCreateFormValues();
  }

  useEffect(() => {
    if (!open) {
      autoOpenedCreateRef.current = false;
      setFormModalOpen(false);
      setEditingId(null);
      return;
    }
    if (autoOpenedCreateRef.current || editingId || formModalOpen) return;
    if (!repositoryOwnerScopeOnly || !initialCreateEmployeeName?.trim()) return;
    autoOpenedCreateRef.current = true;
    openCreateFormModal();
  }, [
    open,
    editingId,
    formModalOpen,
    repositoryOwnerScopeOnly,
    initialCreateEmployeeName,
    defaultRepositoryIds,
    singleOwnerRepositoryId,
    singleProjectScopeId,
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
        closeFormModal();
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
        closeFormModal();
        return;
      }
      const selectedRepositoryIds: number[] = values.repositoryIds ?? defaultRepositoryIds;
      const mergedRepositoryIds = Array.from(new Set([...defaultRepositoryIds, ...selectedRepositoryIds]));
      await onCreate({ name: values.name, agentType: values.agentType, enabled: true, repositoryIds: mergedRepositoryIds });
      closeFormModal();
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

  const employeeFormModal = (
    <Modal
      title={editingEmployee ? "编辑角色" : "新增角色"}
      open={formModalOpen}
      onCancel={closeFormModal}
      onOk={() => void handleSubmit()}
      okText={editingEmployee ? "保存" : "新增"}
      cancelText="取消"
      confirmLoading={loading}
      width={400}
      destroyOnHidden
      wrapClassName="app-employee-config-form-modal"
      maskClosable={false}
    >
      <Form
        form={form}
        layout="vertical"
        size="small"
        colon={false}
        initialValues={{
          name: "",
          agentType: "executor",
          repositoryIds: defaultRepositoryIds,
          ownerRepositoryId: undefined,
        }}
        className="app-employee-config-form--modal"
      >
        {projects && projects.length > 0 && !repositoryOwnerScopeOnly && !singleProjectScopeId ? (
          <Form.Item name="projectIds" label="所属工作区">
            <Select
              mode="multiple"
              allowClear
              placeholder="选择所属工作区"
              maxTagCount="responsive"
              options={projects.map((p) => ({
                value: p.id,
                label: p.name,
              }))}
            />
          </Form.Item>
        ) : null}
        {(!hideRepositorySelector || repositoryOwnerScopeOnly) ? (
          <Form.Item name="repositoryIds" label="关联仓库">
            <Select
              mode="multiple"
              allowClear={!repositoryOwnerScopeOnly}
              placeholder="选择关联仓库"
              maxTagCount="responsive"
              disabled={repositoryOwnerScopeOnly}
              options={repositories.map((repository) => ({
                value: repository.id,
                label: repositoryFolderBasename(repository),
              }))}
            />
          </Form.Item>
        ) : null}
        <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}>
          <Input placeholder="Agent 角色名称" allowClear />
        </Form.Item>
        <Form.Item name="agentType" label="智能体" rules={[{ required: true, message: "请选择智能体" }]}>
          <Select
            showSearch
            placeholder="选择智能体"
            options={selectableAgentTypeOptions}
            optionFilterProp="label"
          />
        </Form.Item>
        {projectOwnerPickMode && !editingEmployee && !singleOwnerRepositoryId ? (
          <Form.Item
            name="ownerRepositoryId"
            label="仓库"
            tooltip="作为该仓唯一主 Owner 的新角色将关联此仓库"
          >
            <Select
              allowClear
              showSearch
              placeholder="选择仓库（每仓仅 1 名 Owner）"
              optionFilterProp="label"
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
        ) : null}
      </Form>
    </Modal>
  );

  const content = (
    <Space orientation="vertical" size={6} className="app-employee-config-modal">
        <div className="app-employee-config-toolbar">
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            className="app-employee-add-btn"
            onClick={openCreateFormModal}
          >
            新增角色
          </Button>
        </div>
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
                    <div className="app-employee-role-cell app-employee-role-cell--gap">
                      <div className="app-employee-avatar app-employee-avatar--gap">
                        ?
                      </div>
                      <Space size={4} wrap>
                        <Typography.Text ellipsis={{ tooltip: row.repoLabel }} className="app-employee-gap-label">{row.repoLabel}</Typography.Text>
                        <span className="app-employee-gap-tag">仅仓库</span>
                      </Space>
                    </div>
                  );
                }
                return (
                  <div className="app-employee-role-cell">
                    <div className="app-employee-avatar" style={getAvatarStyle(row.name)}>
                      {getInitials(row.name)}
                    </div>
                    <span className="app-employee-role-name">{row.name}</span>
                  </div>
                );
              },
            },
            {
              title: "智能体",
              key: "agentType",
              render: (_, row) => {
                const name = isRepoOwnerGapRow(row) ? row.agentName : row.agentType;
                return <code className="app-employee-agent-badge">{name}</code>;
              },
            },
            ...(projectOwnerPickMode
              ? [
                  {
                    title: "Owner 标识",
                    key: "ownerScope",
                    render: (_: unknown, row: EmployeeConfigTableRow) => {
                      if (isRepoOwnerGapRow(row)) {
                        return (
                          <span className="app-employee-owner-tag app-employee-owner-tag--main">
                            主 Owner
                          </span>
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
                        <span className="app-employee-owner-tag app-employee-owner-tag--regular">
                          Owner
                        </span>
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
                return teamEmployeeIds.has(row.id) ? (
                  <span className="app-orchestration-tag app-orchestration-tag--active">已编排</span>
                ) : (
                  <span className="app-orchestration-tag app-orchestration-tag--pending">待编排</span>
                );
              },
            },
            {
              title: "状态",
              key: "enabled",
              render: (_: unknown, row) => {
                if (isRepoOwnerGapRow(row)) {
                  return (
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      —
                    </Typography.Text>
                  );
                }
                return (
                  <Switch
                    size="small"
                    className="app-employee-status-switch"
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
                      在单仓中关联仓库
                    </Typography.Text>
                  );
                }
                return (
                  <Space size={4} className="app-employee-actions-cell">
                    <Button
                      size="small"
                      type="text"
                      className="app-employee-btn app-employee-btn--edit"
                      onClick={() => openEditFormModal(row)}
                    >
                      编辑
                    </Button>
                    <Popconfirm
                      title="确认删除该角色？"
                      onConfirm={() => onDelete(row.id)}
                      okText="删除"
                      cancelText="取消"
                      overlayClassName="app-employee-popconfirm"
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        className="app-employee-btn app-employee-btn--delete"
                      >
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
    return (
      <div className="app-employee-config-inline-root">
        {content}
        {employeeFormModal}
      </div>
    );
  }

  return (
    <>
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
      {employeeFormModal}
    </>
  );
}
