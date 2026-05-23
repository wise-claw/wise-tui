import { Form, Input, Modal } from "antd";
import type { FormInstance } from "antd";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";
import { MATERIALS } from "../workflowGraph/workflowX6CanvasShared";
  title: string;
  knowledgeQuery: string;
  codeScript: string;
}

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowTransformNodeFormValues>;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowTransformNodeEditModal({ editingNode, form, onCancel, onSubmit }: Props) {
  const materialKey = editingNode?.materialKey ?? "knowledge";
  const material = MATERIALS[materialKey] ?? MATERIALS.knowledge;

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
          knowledgeQuery: "",
          codeScript: "",
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder={material.title} />
        </Form.Item>
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
      </Form>
    </Modal>
  );
}
