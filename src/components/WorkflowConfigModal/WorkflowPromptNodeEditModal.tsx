import { DeleteOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Select, Space, Switch, Typography } from "antd";
import type { FormInstance } from "antd";
import { Suspense, lazy, useMemo, useState } from "react";
import type { WorkflowPromptInjectionMode, WorkflowPromptMessageRole } from "../../types/workflowPrompt";
import { DEFAULT_WORKFLOW_PROMPT_CONFIG } from "../../types/workflowPrompt";
import { previewPromptConfig } from "../../services/workflowPromptTemplate";
import { WORKFLOW_PROMPT_BUILTIN_VARIABLES } from "../../services/workflowPromptTemplate";
import type { WorkflowPromptTemplateConfig } from "../../types/workflowPrompt";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

const MilkdownEditor = lazy(() => import("../MilkdownViewer").then((module) => ({ default: module.MilkdownEditor })));

export interface WorkflowPromptNodeFormValues {
  title: string;
  messages: WorkflowPromptTemplateConfig["messages"];
  injectionMode: WorkflowPromptInjectionMode;
  requireAcknowledgement: boolean;
}

const ROLE_OPTIONS: { value: WorkflowPromptMessageRole; label: string }[] = [
  { value: "system", label: "System · 系统指令" },
  { value: "user", label: "User · 用户任务" },
  { value: "assistant", label: "Assistant · 示例回复" },
];

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowPromptNodeFormValues>;
  variableOptions: { value: string; label: string }[];
  taskContentPreview?: string;
  onCancel: () => void;
  onSubmit: () => void;
}

export function WorkflowPromptNodeEditModal({
  editingNode,
  form,
  variableOptions,
  taskContentPreview = "",
  onCancel,
  onSubmit,
}: Props) {
  const [showPreview, setShowPreview] = useState(true);
  const watched = Form.useWatch([], form);

  const insertTargets = useMemo(() => {
    const builtins = WORKFLOW_PROMPT_BUILTIN_VARIABLES.map((item) => ({
      token: `{{${item.name}}}`,
      label: item.label,
    }));
    const fromStart = variableOptions.map((item) => ({
      token: `{{${item.value}}}`,
      label: item.label,
    }));
    return [...fromStart, ...builtins];
  }, [variableOptions]);

  const previewText = useMemo(() => {
    const values = (watched ?? form.getFieldsValue()) as Partial<WorkflowPromptNodeFormValues>;
    const config: WorkflowPromptTemplateConfig = {
      messages: values.messages ?? DEFAULT_WORKFLOW_PROMPT_CONFIG.messages,
      injectionMode: values.injectionMode ?? "structured_block",
      requireAcknowledgement: Boolean(values.requireAcknowledgement),
    };
    const variables = Object.fromEntries(variableOptions.map((item) => [item.value, ""]));
    return previewPromptConfig(config, {
      variables,
      taskContent: taskContentPreview,
    });
  }, [watched, form, variableOptions, taskContentPreview]);

  function insertToken(token: string, messageIndex: number) {
    const messages = form.getFieldValue("messages") as WorkflowPromptNodeFormValues["messages"];
    const current = String(messages?.[messageIndex]?.content ?? "");
    form.setFieldValue(["messages", messageIndex, "content"], `${current}${token}`);
  }

  return (
    <Modal
      title="编辑 · 提示词模板"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal app-workflow-prompt-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={800}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{
          title: "提示词模板",
          messages: DEFAULT_WORKFLOW_PROMPT_CONFIG.messages,
          injectionMode: "structured_block",
          requireAcknowledgement: false,
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="提示词模板" />
        </Form.Item>

        <Space wrap style={{ width: "100%", marginBottom: 8 }}>
          <Form.Item label="注入方式" name="injectionMode" style={{ marginBottom: 0, minWidth: 220 }}>
            <Select
              size="small"
              options={[
                { value: "structured_block", label: "结构化块（System/User 分段）" },
                { value: "user_prefix", label: "用户前缀（仅 User 段）" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="要求模板确认"
            name="requireAcknowledgement"
            valuePropName="checked"
            style={{ marginBottom: 0 }}
          >
            <Switch size="small" checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "隐藏预览" : "显示预览"}
          </Button>
        </Space>

        <div className="app-workflow-prompt-edit-modal__var-bar">
          <Typography.Text type="secondary" className="app-workflow-prompt-edit-modal__var-label">
            插入变量：
          </Typography.Text>
          <Space size={[4, 4]} wrap>
            {insertTargets.map((item) => (
              <Button
                key={item.token}
                size="small"
                type="dashed"
                onClick={() => {
                  const messages = form.getFieldValue("messages") as WorkflowPromptNodeFormValues["messages"];
                  const targetIndex = Math.max(
                    0,
                    messages.findIndex((m) => m.role === "user") >= 0
                      ? messages.findIndex((m) => m.role === "user")
                      : 0,
                  );
                  insertToken(item.token, targetIndex);
                }}
              >
                {item.label}
              </Button>
            ))}
          </Space>
        </div>

        <Form.List name="messages">
          {(fields, { add, remove }) => (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {fields.map((field, index) => (
                <div key={field.key} className="app-workflow-prompt-edit-modal__message-card">
                  <div className="app-workflow-prompt-edit-modal__message-head">
                    <Typography.Text strong>消息 {index + 1}</Typography.Text>
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
                  <Form.Item name={[field.name, "role"]} label="角色" style={{ marginBottom: 8 }}>
                    <Select size="small" options={ROLE_OPTIONS} />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "content"]}
                    label="内容（Markdown）"
                    rules={[{ required: true, message: "请输入消息内容" }]}
                  >
                    <div className="app-workflow-node-edit-form__milkdown-block">
                      <div className="app-workflow-node-edit-form__milkdown-editor app-workflow-prompt-edit-modal__editor">
                        <Suspense fallback={null}>
                          <MilkdownEditor
                            floatingToolbar={false}
                            text={String(form.getFieldValue(["messages", field.name, "content"]) ?? "")}
                            onChange={(markdown) => form.setFieldValue(["messages", field.name, "content"], markdown)}
                          />
                        </Suspense>
                      </div>
                    </div>
                  </Form.Item>
                  <Space size={[4, 4]} wrap>
                    {insertTargets.map((item) => (
                      <Button key={`${field.key}-${item.token}`} size="small" type="link" onClick={() => insertToken(item.token, field.name)}>
                        + {item.label}
                      </Button>
                    ))}
                  </Space>
                </div>
              ))}
              <Button
                type="dashed"
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  add({
                    id: `pm-${Date.now()}`,
                    role: "user",
                    content: "",
                  })
                }
                block
              >
                添加消息段
              </Button>
            </Space>
          )}
        </Form.List>

        {showPreview ? (
          <div className="app-workflow-prompt-edit-modal__preview">
            <Typography.Text strong>派发预览</Typography.Text>
            <Typography.Text type="secondary" className="app-workflow-prompt-edit-modal__preview-hint">
              使用工作流变量默认值与示例占位；运行时替换为真实任务内容与上阶段输出。
            </Typography.Text>
            <pre className="app-workflow-prompt-edit-modal__preview-body">{previewText}</pre>
          </div>
        ) : null}
      </Form>
    </Modal>
  );
}
