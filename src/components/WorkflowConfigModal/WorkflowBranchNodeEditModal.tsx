import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd";
import type { WorkflowBranchCondition, WorkflowBranchConditionKind, WorkflowBranchRuleOperator } from "../../types/workflowBranch";
import { DEFAULT_WORKFLOW_BRANCH_CONDITIONS } from "../../types/workflowBranch";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

export interface WorkflowBranchNodeFormValues {
  title: string;
  branchCriteria: string;
  branchConditions: WorkflowBranchCondition[];
}

const KIND_OPTIONS: { value: WorkflowBranchConditionKind; label: string }[] = [
  { value: "acceptance_pass", label: "验收通过" },
  { value: "acceptance_reject", label: "验收驳回" },
  { value: "rules", label: "规则组（变量/输出比较）" },
  { value: "expression", label: "表达式" },
  { value: "default", label: "默认（兜底）" },
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
  { value: "variable", label: "工作流变量" },
  { value: "last_output", label: "上阶段输出" },
  { value: "acceptance", label: "验收结论" },
];

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowBranchNodeFormValues>;
  variableOptions: { value: string; label: string }[];
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowBranchNodeEditModal({ editingNode, form, variableOptions, onCancel, onSubmit }: Props) {
  return (
    <Modal
      title="编辑 · 条件分支"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal app-workflow-branch-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={720}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{
          title: "条件分支",
          branchCriteria: "",
          branchConditions: DEFAULT_WORKFLOW_BRANCH_CONDITIONS,
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="条件分支" />
        </Form.Item>
        <Form.Item label="分支说明（可选）" name="branchCriteria">
          <Input.TextArea rows={2} placeholder="描述该分支节点的业务含义，便于团队理解。" />
        </Form.Item>

        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title">分支条件</span>
          <Typography.Text type="secondary" className="app-workflow-branch-edit-modal__hint">
            按顺序匹配，命中第一条即路由；请为每条分支从对应出口连线。
          </Typography.Text>
        </div>

        <Form.List name="branchConditions">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div key={field.key} className="app-workflow-branch-edit-modal__branch-card">
                  <div className="app-workflow-branch-edit-modal__branch-head">
                    <Typography.Text strong>分支 {index + 1}</Typography.Text>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      disabled={fields.length <= 1}
                      onClick={() => remove(field.name)}
                    >
                      删除
                    </Button>
                  </div>

                  <Space wrap style={{ width: "100%" }}>
                    <Form.Item
                      label="出口标签"
                      name={[field.name, "label"]}
                      rules={[{ required: true, message: "请输入标签" }]}
                      style={{ flex: 1, minWidth: 140 }}
                    >
                      <Input size="small" placeholder="例如：高优先级" />
                    </Form.Item>
                    <Form.Item
                      label="端口 ID"
                      name={[field.name, "portId"]}
                      tooltip="画布连线 sourcePort，默认 branch-0 / if / else"
                      style={{ flex: 1, minWidth: 120 }}
                    >
                      <Input size="small" placeholder={`branch-${index}`} />
                    </Form.Item>
                    <Form.Item label="匹配类型" name={[field.name, "kind"]} style={{ flex: 1.2, minWidth: 180 }}>
                      <Select size="small" options={KIND_OPTIONS} />
                    </Form.Item>
                  </Space>

                  <Form.Item shouldUpdate noStyle>
                    {({ getFieldValue }) => {
                      const kind = getFieldValue(["branchConditions", field.name, "kind"]) as WorkflowBranchConditionKind;
                      if (kind === "rules") {
                        return (
                          <>
                            <Form.Item label="规则组合" name={[field.name, "logic"]}>
                              <Select
                                size="small"
                                options={[
                                  { value: "and", label: "全部满足 (AND)" },
                                  { value: "or", label: "任一满足 (OR)" },
                                ]}
                              />
                            </Form.Item>
                            <Form.List name={[field.name, "rules"]}>
                              {(ruleFields, { add: addRule, remove: removeRule }) => (
                                <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                                  {ruleFields.map((ruleField) => (
                                    <Space key={ruleField.key} wrap align="start" style={{ width: "100%" }}>
                                      <Form.Item name={[ruleField.name, "source"]} style={{ width: 120, marginBottom: 0 }}>
                                        <Select size="small" options={SOURCE_OPTIONS} />
                                      </Form.Item>
                                      <Form.Item shouldUpdate noStyle>
                                        {({ getFieldValue: getRuleValue }) =>
                                          getRuleValue(["branchConditions", field.name, "rules", ruleField.name, "source"]) === "variable" ? (
                                            <Form.Item name={[ruleField.name, "key"]} style={{ width: 140, marginBottom: 0 }}>
                                              <Select
                                                size="small"
                                                allowClear
                                                showSearch
                                                placeholder="变量"
                                                options={variableOptions}
                                              />
                                            </Form.Item>
                                          ) : null
                                        }
                                      </Form.Item>
                                      <Form.Item name={[ruleField.name, "operator"]} style={{ width: 120, marginBottom: 0 }}>
                                        <Select size="small" options={OPERATOR_OPTIONS} />
                                      </Form.Item>
                                      <Form.Item name={[ruleField.name, "value"]} style={{ flex: 1, minWidth: 160, marginBottom: 0 }}>
                                        <Input size="small" placeholder="比较值，支持 {{var}}" />
                                      </Form.Item>
                                      <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeRule(ruleField.name)} />
                                    </Space>
                                  ))}
                                  <Button
                                    type="dashed"
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={() => addRule({ source: "variable", operator: "eq", value: "" })}
                                  >
                                    添加规则
                                  </Button>
                                </Space>
                              )}
                            </Form.List>
                          </>
                        );
                      }
                      if (kind === "expression") {
                        return (
                          <Form.Item
                            label="表达式"
                            name={[field.name, "expression"]}
                            extra='示例：{{priority}} == "high"；contains({{last_output}}, "error")；acceptance == pass'
                          >
                            <Input.TextArea rows={3} placeholder='{{score}} >= 80' />
                          </Form.Item>
                        );
                      }
                      return null;
                    }}
                  </Form.Item>
                </div>
              ))}
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({
                    id: `bc-${Date.now()}`,
                    label: `分支 ${fields.length + 1}`,
                    portId: `branch-${fields.length}`,
                    kind: "rules",
                    logic: "and",
                    rules: [{ source: "variable", operator: "eq", value: "" }],
                  })
                }
                block
              >
                添加分支
              </Button>
            </Space>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
}
