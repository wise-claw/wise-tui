import { Form, Input, Modal } from "antd";
import type { FormInstance } from "antd";
import { Suspense, lazy } from "react";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";
import { MATERIALS } from "../workflowGraph/workflowX6CanvasShared";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

export interface WorkflowTransformNodeFormValues {
  title: string;
  promptTemplate: string;
  knowledgeQuery: string;
  codeScript: string;
  branchCriteria: string;
}

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowTransformNodeFormValues>;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowTransformNodeEditModal({ editingNode, form, onCancel, onSubmit }: Props) {
  const materialKey = editingNode?.materialKey ?? "prompt";
  const material = MATERIALS[materialKey] ?? MATERIALS.prompt;

  return (
    <Modal
      title={`编辑 · ${material.title}`}
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
          promptTemplate: "",
          knowledgeQuery: "",
          codeScript: "",
          branchCriteria: "",
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder={material.title} />
        </Form.Item>
        {materialKey === "prompt" ? (
          <Form.Item
            label="提示词模板"
            name="promptTemplate"
            rules={[{ validator: async (_, value: unknown) => { if (typeof value === "string" && value.trim()) return; throw new Error("请输入提示词模板"); } }]}
          >
            <div className="app-workflow-node-edit-form__milkdown-block">
              <div className="app-workflow-node-edit-form__milkdown-editor">
                <Suspense fallback={null}>
                  <MilkdownEditor
                    floatingToolbar={false}
                    text={String(form.getFieldValue("promptTemplate") ?? "")}
                    onChange={(markdown) => form.setFieldValue("promptTemplate", markdown)}
                  />
                </Suspense>
              </div>
            </div>
          </Form.Item>
        ) : null}
        {materialKey === "knowledge" ? (
          <Form.Item label="检索语句" name="knowledgeQuery" rules={[{ required: true, message: "请输入检索语句" }]}>
            <Input.TextArea rows={4} placeholder="例如：与 {{topic}} 相关的 API 路由与数据模型" />
          </Form.Item>
        ) : null}
        {materialKey === "code" ? (
          <Form.Item label="脚本/命令说明" name="codeScript" rules={[{ required: true, message: "请输入脚本说明" }]}>
            <Input.TextArea rows={6} placeholder="例如：bun test src/services/workflowGraphRuntime.test.ts" />
          </Form.Item>
        ) : null}
        {materialKey === "branch" ? (
          <Form.Item label="分支说明（可选）" name="branchCriteria">
            <Input.TextArea rows={3} placeholder="说明通过/驳回路径的业务含义；连线请从「通过」「驳回」端口引出。" />
          </Form.Item>
        ) : null}
      </Form>
    </Modal>
  );
}
