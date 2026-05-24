import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import type { WorkflowBranchCondition, WorkflowBranchConditionKind, WorkflowBranchRuleOperator } from "../../types/workflowBranch";
import type { WorkflowVariableDefinition } from "../../types";
import {
  DEFAULT_WORKFLOW_LOOP_MAX_ITERATIONS,
  MAX_WORKFLOW_LOOP_MAX_ITERATIONS,
  MIN_WORKFLOW_LOOP_MAX_ITERATIONS,
} from "../../types/workflowLoop";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

export interface WorkflowLoopNodeFormValues {
  title: string;
  loopMaxIterations: number;
  loopVariables: WorkflowVariableDefinition[];
  loopExitConditions: WorkflowBranchCondition[];
}

const KIND_OPTIONS: { value: WorkflowBranchConditionKind; label: string }[] = [
  { value: "rules", label: "规则组（变量/输出比较）" },
  { value: "expression", label: "表达式" },
  { value: "acceptance_pass", label: "验收通过" },
  { value: "acceptance_reject", label: "验收驳回" },
];

const OPERATOR_OPTIONS: { value: WorkflowBranchRuleOperator; label: string }[] = [
  { value: "eq", label: "等于" },
  { value: "neq", label: "不等于" },
  { value: "contains", label: "包含" },
  { value: "not_contains", label: "不包含" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" },
  { value: "empty", label: "为空" },
  { value: "not_empty", label: "不为空" },
  { value: "regex", label: "正则匹配" },
];

const SOURCE_OPTIONS = [
  { value: "variable", label: "工作流/循环变量" },
  { value: "last_output", label: "上阶段输出" },
  { value: "acceptance", label: "验收结论" },
];

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowLoopNodeFormValues>;
  variableOptions: { value: string; label: string }[];
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowLoopNodeEditModal({ editingNode, form, variableOptions, onCancel, onSubmit }: Props) {
  return (
    <Modal
      title="编辑 · 循环"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal app-workflow-loop-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={760}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{
          title: "循环",
          loopMaxIterations: DEFAULT_WORKFLOW_LOOP_MAX_ITERATIONS,
          loopVariables: [],
          loopExitConditions: [],
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="循环" />
        </Form.Item>
        <Form.Item
          label="最大循环次数"
          name="loopMaxIterations"
          rules={[{ required: true, message: "请设置最大循环次数" }]}
          extra="达到上限后强制退出循环，防止无限执行。"
        >
          <InputNumber
            min={MIN_WORKFLOW_LOOP_MAX_ITERATIONS}
            max={MAX_WORKFLOW_LOOP_MAX_ITERATIONS}
            style={{ width: "100%" }}
          />
        </Form.Item>

        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title">循环变量</span>
          <Typography.Text type="secondary" className="app-workflow-branch-edit-modal__hint">
            仅在循环体内生效，可覆盖同名工作流变量；运行时自动注入 loop_index / loop_iteration。
          </Typography.Text>
        </div>
        <Form.List name="loopVariables">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={8} style={{ width: "100%", marginBottom: 16 }}>
              {fields.map((field) => (
                <Space key={field.key} align="start" style={{ width: "100%" }}>
                  <Form.Item
                    name={[field.name, "name"]}
                    rules={[{ required: true, message: "变量名" }]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input size="small" placeholder="变量名（英文）" />
                  </Form.Item>
                  <Form.Item name={[field.name, "label"]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input size="small" placeholder="显示名称（可选）" />
                  </Form.Item>
                  <Form.Item name={[field.name, "defaultValue"]} style={{ flex: 1, marginBottom: 0 }}>
                    <Input size="small" placeholder="默认值" />
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                </Space>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ name: "", label: "", defaultValue: "" })}>
                添加循环变量
              </Button>
            </Space>
          )}
        </Form.List>

        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title">循环终止条件</span>
          <Typography.Text type="secondary" className="app-workflow-branch-edit-modal__hint">
            满足任一条件即退出循环；未配置时仅按最大次数终止。循环体末节点请用「返回循环」出口连回本节点。
          </Typography.Text>
        </div>
        <Form.List name="loopExitConditions">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div key={field.key} className="app-workflow-branch-edit-modal__branch-card">
                  <div className="app-workflow-branch-edit-modal__branch-head">
                    <Typography.Text strong>条件 {index + 1}</Typography.Text>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  </div>
                  <Space wrap style={{ width: "100%" }}>
                    <Form.Item label="标签" name={[field.name, "label"]} style={{ minWidth: 140 }}>
                      <Input size="small" placeholder="例如：结果已就绪" />
                    </Form.Item>
                    <Form.Item label="类型" name={[field.name, "kind"]} style={{ minWidth: 160 }}>
                      <Select size="small" options={KIND_OPTIONS} />
                    </Form.Item>
                    <Form.Item label="逻辑" name={[field.name, "logic"]} style={{ minWidth: 100 }}>
                      <Select
                        size="small"
                        options={[
                          { value: "and", label: "全部满足" },
                          { value: "or", label: "任一满足" },
                        ]}
                      />
                    </Form.Item>
                  </Space>
                  <Form.Item label="表达式（kind=expression）" name={[field.name, "expression"]}>
                    <Input.TextArea rows={2} placeholder='例如：contains(last_output, "done")' />
                  </Form.Item>
                  <Form.List name={[field.name, "rules"]}>
                    {(ruleFields, { add: addRule, remove: removeRule }) => (
                      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                        {ruleFields.map((ruleField) => (
                          <Space key={ruleField.key} wrap align="start">
                            <Form.Item name={[ruleField.name, "source"]} style={{ marginBottom: 0 }}>
                              <Select size="small" style={{ width: 130 }} options={SOURCE_OPTIONS} />
                            </Form.Item>
                            <Form.Item name={[ruleField.name, "key"]} style={{ marginBottom: 0 }}>
                              <Select
                                size="small"
                                style={{ width: 140 }}
                                allowClear
                                showSearch
                                placeholder="变量"
                                options={variableOptions}
                              />
                            </Form.Item>
                            <Form.Item name={[ruleField.name, "operator"]} style={{ marginBottom: 0 }}>
                              <Select size="small" style={{ width: 110 }} options={OPERATOR_OPTIONS} />
                            </Form.Item>
                            <Form.Item name={[ruleField.name, "value"]} style={{ marginBottom: 0 }}>
                              <Input size="small" style={{ width: 120 }} placeholder="比较值" />
                            </Form.Item>
                            <Button type="text" danger size="small" onClick={() => removeRule(ruleField.name)}>
                              删规则
                            </Button>
                          </Space>
                        ))}
                        <Button type="dashed" size="small" onClick={() => addRule({ source: "variable", operator: "eq", value: "" })}>
                          添加规则
                        </Button>
                      </Space>
                    )}
                  </Form.List>
                </div>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({
                    id: `loop-exit-${Date.now()}`,
                    label: `终止条件 ${fields.length + 1}`,
                    portId: `loop-exit-${fields.length}`,
                    kind: "rules",
                    logic: "and",
                    rules: [],
                  })
                }
              >
                添加终止条件
              </Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
