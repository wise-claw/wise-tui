import { DeleteOutlined, PlusOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import { HoverHint } from "../shared/HoverHint";
import { Button, Form, Input, Modal, Select, Space, Switch } from "antd";
import type { FormInstance } from "antd";
import { Suspense, lazy } from "react";
import type { WorkflowStageOutcomeCriterion } from "../../types";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";
import { OPTIMIZE_TONE_OPTIONS, type OptimizeTone } from "./optimizeTone";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

export interface WorkflowNodeEditFormValues {
  title: string;
  stageTask: string;
  stageTaskBasisRefs?: string[];
  employeeId?: string;
  stageSuccessCriteria?: WorkflowStageOutcomeCriterion[];
  acceptanceEnabled: boolean;
  acceptanceCriteria: string;
}

interface WorkflowNodeEditModalProps {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowNodeEditFormValues>;
  stageTaskBasisSelectOptions: { value: string; label: string }[];
  employeeOptions: { value: string; label: string }[];
  optimizeToneByField: Record<"stageTask" | "acceptanceCriteria", OptimizeTone>;
  optimizingField: "stageTask" | "acceptanceCriteria" | null;
  canOptimize: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  onOptimize: (field: "stageTask" | "acceptanceCriteria") => void;
  onOptimizeToneChange: (field: "stageTask" | "acceptanceCriteria", tone: OptimizeTone) => void;
}

export function WorkflowNodeEditModal({
  editingNode,
  form,
  stageTaskBasisSelectOptions,
  employeeOptions,
  optimizeToneByField,
  optimizingField,
  canOptimize,
  onCancel,
  onSubmit,
  onOptimize,
  onOptimizeToneChange,
}: WorkflowNodeEditModalProps) {
  return (
    <Modal
      title="编辑阶段节点"
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
        initialValues={{
          title: "",
          stageTask: "",
          stageTaskBasisRefs: undefined,
          stageSuccessCriteria: [],
          acceptanceEnabled: false,
          acceptanceCriteria: "",
        }}
      >
        <Form.Item label="阶段名称" name="title" rules={[{ required: true, message: "请输入阶段名称" }]}>
          <Input size="small" placeholder="例如：代码评审" />
        </Form.Item>
        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title app-workflow-node-edit-form__field-title--with-hint">
            阶段任务依据（可选）
            <HoverHint placement="topLeft" styles={{ container: { maxWidth: 400 } }} title="从当前工作流画布中各阶段已配置的「阶段成果」中选择一项或多项；保存后随工作流派发写入 Claude Code 会话，置于「阶段任务」正文之前（多项之间以分隔线隔开）。每条派发为「【阶段任务依据】成果「名称」」并附上该成果标准原文。">
              <QuestionCircleOutlined className="app-workflow-node-edit-form__field-hint-icon" aria-label="阶段任务依据说明" />
            </HoverHint>
          </span>
        </div>
        <Form.Item name="stageTaskBasisRefs">
          <Select
            mode="multiple"
            size="small"
            allowClear
            showSearch
            optionFilterProp="label"
            maxTagCount="responsive"
            placeholder={stageTaskBasisSelectOptions.length === 0 ? "请先在部分阶段配置「阶段成果」" : "选择工作流内已有成果（可多选）…"}
            options={stageTaskBasisSelectOptions}
            disabled={stageTaskBasisSelectOptions.length === 0}
          />
        </Form.Item>
        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title">阶段任务</span>
          <span className="app-workflow-node-edit-form__label-actions">
            <Select
              size="small"
              value={optimizeToneByField.stageTask}
              options={OPTIMIZE_TONE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
              onChange={(value: OptimizeTone) => onOptimizeToneChange("stageTask", value)}
              className="app-workflow-node-edit-form__optimize-tone"
            />
            <Button size="small" loading={optimizingField === "stageTask"} disabled={!canOptimize} onClick={() => onOptimize("stageTask")}>
              AI优化
            </Button>
          </span>
        </div>
        <Form.Item name="stageTask" rules={[{ validator: async (_, value: unknown) => { if (typeof value === "string" && value.trim()) return; throw new Error("请输入阶段任务"); } }]}>
          <div className="app-workflow-node-edit-form__milkdown-block">
            <div className="app-workflow-node-edit-form__milkdown-editor">
              <Suspense fallback={null}>
                <MilkdownEditor floatingToolbar={false} text={String(form.getFieldValue("stageTask") ?? "")} onChange={(markdown) => form.setFieldValue("stageTask", markdown)} />
              </Suspense>
            </div>
          </div>
        </Form.Item>
        <Form.Item label="执行终端" name="employeeId" rules={[{ required: true, message: "请选择执行终端" }]}>
          <Select size="small" allowClear showSearch options={employeeOptions} placeholder="请选择终端" />
        </Form.Item>
        <div className="app-workflow-node-edit-form__field-header">
          <span className="app-workflow-node-edit-form__field-title app-workflow-node-edit-form__field-title--with-hint">
            阶段成果（可选）
            <HoverHint placement="topLeft" styles={{ container: { maxWidth: 400 } }} title="每条包含「名称」与「要求」：名称简要标识该成果项；要求用 Markdown 编写。若有配置，会与阶段任务一并作为强约束发往该阶段的 Claude Code 会话；模型处理完任务后须在回复末尾输出约定的 JSON 阶段成果报告（详见派发全文中的格式说明）。">
              <QuestionCircleOutlined className="app-workflow-node-edit-form__field-hint-icon" aria-label="阶段成果说明" />
            </HoverHint>
          </span>
        </div>
        <Form.List name="stageSuccessCriteria">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {fields.map((field) => (
                <div key={field.key} className="app-workflow-node-edit-form__milkdown-block">
                  <div className="app-workflow-node-edit-form__field-header">
                    <span className="app-workflow-node-edit-form__field-title">成果 {field.name + 1}</span>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>删除</Button>
                  </div>
                  <Form.Item className="app-workflow-node-edit-form__outcome-name" name={[field.name, "name"]} rules={[{ max: 120, message: "名称不超过 120 字" }]}>
                    <Input size="small" placeholder="名称，例如：接口契约确认" allowClear />
                  </Form.Item>
                  <Form.Item name={[field.name, "requirement"]} rules={[{ required: true, message: "请用 Markdown 编写该成果的要求" }]}>
                    <div className="app-workflow-node-edit-form__milkdown-editor">
                      <Suspense fallback={null}>
                        <MilkdownEditor key={field.key} floatingToolbar={false} text={String(form.getFieldValue(["stageSuccessCriteria", field.name, "requirement"]) ?? "")} onChange={(markdown) => form.setFieldValue(["stageSuccessCriteria", field.name, "requirement"], markdown)} />
                      </Suspense>
                    </div>
                  </Form.Item>
                </div>
              ))}
              <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ name: "", requirement: "" })} block>
                添加阶段成果标准
              </Button>
            </Space>
          )}
        </Form.List>
        <div className="app-workflow-node-edit-form__acceptance-toggle">
          <div className="app-workflow-node-edit-form__field-header">
            <span className="app-workflow-node-edit-form__field-title">上阶段成果验收评判（可选）</span>
            <span className="app-workflow-node-edit-form__label-actions">
              <Form.Item name="acceptanceEnabled" valuePropName="checked" noStyle>
                <Switch size="small" checkedChildren="开启" unCheckedChildren="关闭" />
              </Form.Item>
            </span>
          </div>
        </div>
        <Form.Item shouldUpdate={(prev, next) => prev.acceptanceEnabled !== next.acceptanceEnabled} noStyle>
          {({ getFieldValue }) =>
            getFieldValue("acceptanceEnabled") ? (
              <>
                <div className="app-workflow-node-edit-form__field-header">
                  <span className="app-workflow-node-edit-form__field-title">评判标准</span>
                  <span className="app-workflow-node-edit-form__label-actions">
                    <Select
                      size="small"
                      value={optimizeToneByField.acceptanceCriteria}
                      options={OPTIMIZE_TONE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                      onChange={(value: OptimizeTone) => onOptimizeToneChange("acceptanceCriteria", value)}
                      className="app-workflow-node-edit-form__optimize-tone"
                    />
                    <Button size="small" loading={optimizingField === "acceptanceCriteria"} disabled={!canOptimize} onClick={() => onOptimize("acceptanceCriteria")}>
                      AI优化
                    </Button>
                  </span>
                </div>
                <Form.Item name="acceptanceCriteria" rules={[{ required: true, message: "请输入评判标准" }]}>
                  <div className="app-workflow-node-edit-form__milkdown-block">
                    <div className="app-workflow-node-edit-form__milkdown-editor">
                      <Suspense fallback={null}>
                        <MilkdownEditor floatingToolbar={false} text={String(form.getFieldValue("acceptanceCriteria") ?? "")} onChange={(markdown) => form.setFieldValue("acceptanceCriteria", markdown)} />
                      </Suspense>
                    </div>
                  </div>
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  );
}
