import { Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import type { EmployeeItem, Repository, WorkflowGraph, WorkflowTemplateItem } from "../../types";
import { collectTeamMemberEmployeeIds } from "../../utils/collectTeamMemberEmployeeIds";
import { repositoryFolderBasename } from "../../utils/repositoryType";
import "./index.css";

interface Props {
  open: boolean;
  loading: boolean;
  employees: EmployeeItem[];
  workflowTemplates: WorkflowTemplateItem[];
  workflowGraphsByWorkflowId?: Record<string, WorkflowGraph>;
  repositories: Repository[];
  agentTypeOptions: string[];
  defaultRepositoryIds?: number[];
  onClose: () => void;
  onCreate: (input: { name: string; agentType: string; enabled: boolean; repositoryIds: number[] }) => Promise<void>;
  onUpdate: (input: { employeeId: string; name: string; agentType: string; enabled: boolean; repositoryIds: number[] }) => Promise<void>;
  onDelete: (employeeId: string) => Promise<void>;
}

export function EmployeeConfigModal({
  open,
  loading,
  employees,
  workflowTemplates,
  workflowGraphsByWorkflowId = {},
  repositories,
  agentTypeOptions,
  defaultRepositoryIds = [],
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: Props) {
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
  const teamEmployeeIds = useMemo(
    () => collectTeamMemberEmployeeIds(workflowTemplates, workflowGraphsByWorkflowId),
    [workflowTemplates, workflowGraphsByWorkflowId],
  );

  function handleCreateClick() {
    setEditingId(null);
    form.setFieldsValue({ name: "", agentType: "executor", repositoryIds: defaultRepositoryIds });
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    if (editingEmployee) {
      await onUpdate({
        employeeId: editingEmployee.id,
        name: values.name,
        agentType: values.agentType,
        enabled: editingEmployee.enabled,
        repositoryIds: values.repositoryIds ?? [],
      });
      return;
    }
    const selectedRepositoryIds: number[] = values.repositoryIds ?? [];
    const mergedRepositoryIds = Array.from(new Set([...defaultRepositoryIds, ...selectedRepositoryIds]));
    await onCreate({ name: values.name, agentType: values.agentType, enabled: true, repositoryIds: mergedRepositoryIds });
    form.setFieldsValue({ name: "", agentType: "executor", repositoryIds: defaultRepositoryIds });
  }

  async function handleToggleEnabled(row: EmployeeItem, enabled: boolean) {
    await onUpdate({
      employeeId: row.id,
      name: row.name,
      agentType: row.agentType,
      enabled,
      repositoryIds: row.repositoryIds,
    });
  }

  return (
    <Modal
      title="员工配置"
      open={open}
      onCancel={onClose}
      footer={null}
      width={860}
      destroyOnHidden
    >
      <Space direction="vertical" size={16} className="app-employee-config-modal">
        <Form
          form={form}
          layout="inline"
          size="small"
          initialValues={{ name: "", agentType: "executor", repositoryIds: defaultRepositoryIds }}
          className="app-employee-config-form"
        >
          <div className={`app-employee-config-row ${hideRepositorySelector ? "app-employee-config-row--compact" : ""}`}>
            <div className="app-employee-config-field">
              <div className="app-employee-config-field-label">员工名称</div>
              <Form.Item
                name="name"
                rules={[{ required: true, message: "请输入员工名称" }]}
                className="app-employee-config-item app-employee-config-item--name"
              >
                <Input placeholder="员工名称" allowClear />
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
            {!hideRepositorySelector ? (
              <div className="app-employee-config-field">
                <div className="app-employee-config-field-label">关联仓库</div>
                <Form.Item
                  name="repositoryIds"
                  className="app-employee-config-item app-employee-config-item--repositories"
                >
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="关联仓库"
                    maxTagCount="responsive"
                    options={repositories.map((repository) => ({
                      value: repository.id,
                      label: repositoryFolderBasename(repository),
                    }))}
                  />
                </Form.Item>
              </div>
            ) : null}
            <div className="app-employee-config-actions">
              <div className="app-employee-config-field-label">操作</div>
              <Button size="small" type="primary" loading={loading} onClick={() => void handleSubmit()}>
                {editingEmployee ? "保存编辑" : "新增员工"}
              </Button>
              {editingEmployee ? <Button size="small" onClick={handleCreateClick}>取消编辑</Button> : null}
            </div>
          </div>
        </Form>
        <Table<EmployeeItem>
          rowKey="id"
          loading={loading}
          dataSource={employees}
          pagination={false}
          size="small"
          columns={[
            { title: "姓名", dataIndex: "name" },
            { title: "智能体", dataIndex: "agentType" },
            {
              title: "团队成员",
              key: "teamMember",
              render: (_, row) =>
                teamEmployeeIds.has(row.id) ? <Tag color="processing">是</Tag> : <Tag>否</Tag>,
            },
            {
              title: "状态",
              dataIndex: "enabled",
              render: (enabled: boolean, row) => (
                <Switch
                  checked={enabled}
                  checkedChildren="启用"
                  unCheckedChildren="禁用"
                  loading={loading}
                  onChange={(next) => {
                    void handleToggleEnabled(row, next);
                  }}
                />
              ),
            },
            {
              title: "操作",
              key: "actions",
              render: (_, row) => (
                <Space size={8}>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingId(row.id);
                      form.setFieldsValue({
                        name: row.name,
                        agentType: row.agentType,
                        repositoryIds: row.repositoryIds,
                      });
                    }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="确认删除该员工？"
                    onConfirm={() => onDelete(row.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Space>
    </Modal>
  );
}
