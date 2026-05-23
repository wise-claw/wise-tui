import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Space } from "antd";
import type { FormInstance } from "antd";
import type { WorkflowVariableDefinition } from "../../types";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

export interface WorkflowStartNodeFormValues {
  title: string;
  workflowVariables: WorkflowVariableDefinition[];
}

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowStartNodeFormValues>;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowStartNodeEditModal({ editingNode, form, onCancel, onSubmit }: Props) {
  return (
    <Modal
      title="编辑开始节点"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={520}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{ title: "开始", workflowVariables: [] }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="开始" />
        </Form.Item>
        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title">工作流变量（可选）</span>
        </div>
        <TypographyHint />
        <Form.List name="workflowVariables">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={10} style={{ width: "100%" }}>
              {fields.map((field) => (
                <Space key={field.key} align="start" style={{ width: "100%" }}>
                  <Form.Item
                    name={[field.name, "name"]}
                    rules={[
                      { required: true, message: "变量名必填" },
                      { pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/, message: "仅支持英文标识符" },
                    ]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input size="small" placeholder="变量名，如 topic" />
                  </Form.Item>
                  <Form.Item name={[field.name, "label"]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input size="small" placeholder="显示名称" />
                  </Form.Item>
                  <Form.Item name={[field.name, "defaultValue"]} style={{ flex: 1.2, marginBottom: 0 }}>
                    <Input size="small" placeholder="默认值" />
                  </Form.Item>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                </Space>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ name: "", label: "", defaultValue: "" })} block>
                添加变量
              </Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}

function TypographyHint() {
  return (
    <p className="app-workflow-node-edit-form__hint">
      在提示词、检索语句等处使用 <code>{"{{变量名}}"}</code> 引用；运行时将替换为默认值。
    </p>
  );
}
