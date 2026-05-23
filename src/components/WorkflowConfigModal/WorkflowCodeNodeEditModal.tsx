import { DeleteOutlined, EyeOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from "antd";
import type { FormInstance } from "antd";
import { Suspense, lazy, useMemo, useState } from "react";
import {
  WORKFLOW_CODE_BUILTIN_VARIABLES,
  WORKFLOW_CODE_LANGUAGE_OPTIONS,
  monacoLanguageForCodeConfig,
  previewCodeConfig,
} from "../../services/workflowCodeExecution";
import type { WorkflowCodeExecutionConfig, WorkflowCodeExecutionMode, WorkflowCodeLanguage } from "../../types/workflowCode";
import { DEFAULT_WORKFLOW_CODE_CONFIG } from "../../types/workflowCode";
import type { CanvasNodeItem } from "../workflowGraph/workflowX6CanvasShared";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export interface WorkflowCodeNodeFormValues {
  title: string;
  mode: WorkflowCodeExecutionMode;
  language: WorkflowCodeLanguage;
  source: string;
  inputBindings: WorkflowCodeExecutionConfig["inputBindings"];
  outputVariables: WorkflowCodeExecutionConfig["outputVariables"];
  requireStructuredOutput: boolean;
  workingDirectory: string;
  timeoutSeconds?: number;
}

const MODE_OPTIONS: { value: WorkflowCodeExecutionMode; label: string }[] = [
  { value: "command", label: "Shell 命令（单行或多行）" },
  { value: "script", label: "脚本片段（按语言高亮）" },
];

interface Props {
  editingNode: CanvasNodeItem | null;
  form: FormInstance<WorkflowCodeNodeFormValues>;
  variableOptions: { value: string; label: string }[];
  taskContentPreview?: string;
  onCancel: () => void;
  onSubmit: () => void;
}

function MonacoCodeField({
  value,
  onChange,
  language,
}: {
  value?: string;
  onChange?: (next: string) => void;
  language: string;
}) {
  return (
    <Suspense
      fallback={
        <Input.TextArea
          rows={8}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder="加载编辑器…"
        />
      }
    >
      <div className="app-workflow-code-edit-modal__editor">
        <MonacoEditor
          height={220}
          language={language}
          value={value ?? ""}
          onChange={(next) => onChange?.(next ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
        />
      </div>
    </Suspense>
  );
}

export function WorkflowCodeNodeEditModal({
  editingNode,
  form,
  variableOptions,
  taskContentPreview = "",
  onCancel,
  onSubmit,
}: Props) {
  const [showPreview, setShowPreview] = useState(true);
  const watched = Form.useWatch([], form);
  const mode = (watched?.mode ?? form.getFieldValue("mode") ?? "command") as WorkflowCodeExecutionMode;
  const language = (watched?.language ?? form.getFieldValue("language") ?? "shell") as WorkflowCodeLanguage;
  const monacoLanguage = monacoLanguageForCodeConfig({ mode, language });

  const insertSources = useMemo(() => {
    const builtins = WORKFLOW_CODE_BUILTIN_VARIABLES.map((item) => ({
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
    const values = (watched ?? form.getFieldsValue()) as Partial<WorkflowCodeNodeFormValues>;
    const config: WorkflowCodeExecutionConfig = {
      mode: values.mode ?? DEFAULT_WORKFLOW_CODE_CONFIG.mode,
      language: values.language ?? DEFAULT_WORKFLOW_CODE_CONFIG.language,
      source: values.source ?? "",
      inputBindings: values.inputBindings ?? [],
      outputVariables: values.outputVariables ?? [],
      requireStructuredOutput: Boolean(values.requireStructuredOutput),
      workingDirectory: values.workingDirectory?.trim() || undefined,
      timeoutSeconds: values.timeoutSeconds,
    };
    const variables = Object.fromEntries(variableOptions.map((item) => [item.value, ""]));
    return previewCodeConfig(config, {
      variables,
      taskContent: taskContentPreview,
    });
  }, [watched, form, variableOptions, taskContentPreview]);

  function appendToSource(token: string) {
    const current = String(form.getFieldValue("source") ?? "");
    form.setFieldValue("source", `${current}${token}`);
  }

  return (
    <Modal
      title="编辑 · 代码执行"
      open={Boolean(editingNode)}
      className="app-workflow-node-edit-modal app-workflow-code-edit-modal"
      onCancel={onCancel}
      onOk={onSubmit}
      width={820}
      destroyOnHidden
    >
      <Form
        className="app-workflow-node-edit-form"
        form={form}
        layout="vertical"
        initialValues={{
          title: "代码执行",
          mode: "command",
          language: "shell",
          source: "",
          inputBindings: [],
          outputVariables: [],
          requireStructuredOutput: false,
          workingDirectory: "",
        }}
      >
        <Form.Item label="节点名称" name="title" rules={[{ required: true, message: "请输入节点名称" }]}>
          <Input size="small" placeholder="代码执行" />
        </Form.Item>

        <Space wrap style={{ width: "100%", marginBottom: 8 }}>
          <Form.Item label="执行方式" name="mode" style={{ marginBottom: 0, minWidth: 220 }}>
            <Select size="small" options={MODE_OPTIONS} />
          </Form.Item>
          <Form.Item label="语言" name="language" style={{ marginBottom: 0, minWidth: 180 }}>
            <Select
              size="small"
              options={WORKFLOW_CODE_LANGUAGE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
              disabled={mode === "command"}
            />
          </Form.Item>
          <Form.Item label="结构化输出" name="requireStructuredOutput" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch size="small" checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
        </Space>

        <Space wrap style={{ width: "100%", marginBottom: 8 }}>
          <Form.Item label="工作目录（可选）" name="workingDirectory" style={{ marginBottom: 0, minWidth: 280 }}>
            <Input size="small" placeholder="例如：src/services" />
          </Form.Item>
          <Form.Item label="超时秒数（可选）" name="timeoutSeconds" style={{ marginBottom: 0, minWidth: 140 }}>
            <InputNumber size="small" min={1} max={3600} placeholder="120" style={{ width: "100%" }} />
          </Form.Item>
        </Space>

        <div className="app-workflow-code-edit-modal__var-bar">
          <Typography.Text type="secondary" className="app-workflow-code-edit-modal__var-label">
            插入变量到脚本：
          </Typography.Text>
          <Space wrap size={[4, 4]}>
            {insertSources.map((item) => (
              <Button key={item.token} size="small" type="dashed" onClick={() => appendToSource(item.token)}>
                {item.label}
              </Button>
            ))}
          </Space>
        </div>

        <Form.Item
          label={mode === "command" ? "命令" : "脚本正文"}
          name="source"
          rules={[{ required: true, message: mode === "command" ? "请输入命令" : "请输入脚本" }]}
        >
          <MonacoCodeField language={monacoLanguage} />
        </Form.Item>

        <Typography.Text strong className="app-workflow-code-edit-modal__section-title">
          输入变量映射
        </Typography.Text>
        <Typography.Paragraph type="secondary" className="app-workflow-node-edit-form__hint">
          将工作流变量映射为脚本内占位符，例如 source=<code>topic</code>、target=<code>alias</code> 时，脚本中的{" "}
          <code>{`{{alias}}`}</code> 会替换为 topic 的值。
        </Typography.Paragraph>
        <Form.List name="inputBindings">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div key={field.key} className="app-workflow-code-edit-modal__binding-row">
                  <Form.Item
                    {...field}
                    name={[field.name, "source"]}
                    label="来源变量"
                    rules={[{ required: true, message: "请选择来源" }]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Select
                      size="small"
                      showSearch
                      optionFilterProp="label"
                      placeholder="工作流变量"
                      options={[
                        ...variableOptions,
                        ...WORKFLOW_CODE_BUILTIN_VARIABLES.map((item) => ({
                          value: item.name,
                          label: `${item.label} (${item.name})`,
                        })),
                      ]}
                    />
                  </Form.Item>
                  <Typography.Text type="secondary">→</Typography.Text>
                  <Form.Item
                    {...field}
                    name={[field.name, "target"]}
                    label="脚本占位符"
                    rules={[{ required: true, message: "请输入占位符名" }]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input size="small" placeholder="alias" />
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="删除映射" />
                </div>
              ))}
              <Button
                type="dashed"
                block
                size="small"
                icon={<PlusOutlined />}
                onClick={() => add({ id: `cb-in-${Date.now()}`, source: "", target: "" })}
              >
                添加输入映射
              </Button>
            </>
          )}
        </Form.List>

        <Typography.Text strong className="app-workflow-code-edit-modal__section-title">
          输出变量
        </Typography.Text>
        <Form.List name="outputVariables">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div key={field.key} className="app-workflow-code-edit-modal__binding-row">
                  <Form.Item
                    {...field}
                    name={[field.name, "name"]}
                    label="变量名"
                    rules={[{ required: true, message: "请输入变量名" }]}
                    style={{ flex: 1, marginBottom: 0 }}
                  >
                    <Input size="small" placeholder="stdout" />
                  </Form.Item>
                  <Form.Item {...field} name={[field.name, "description"]} label="说明" style={{ flex: 2, marginBottom: 0 }}>
                    <Input size="small" placeholder="命令标准输出摘要" />
                  </Form.Item>
                  <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label="删除输出" />
                </div>
              ))}
              <Button
                type="dashed"
                block
                size="small"
                icon={<PlusOutlined />}
                onClick={() => add({ id: `cb-out-${Date.now()}`, name: "", description: "" })}
              >
                添加输出变量
              </Button>
            </>
          )}
        </Form.List>

        <div className="app-workflow-code-edit-modal__preview-toolbar">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setShowPreview((prev) => !prev)}>
            {showPreview ? "隐藏派发预览" : "显示派发预览"}
          </Button>
        </div>
        {showPreview ? (
          <div className="app-workflow-code-edit-modal__preview">
            <Typography.Text strong>派发预览</Typography.Text>
            <Typography.Text type="secondary" className="app-workflow-code-edit-modal__preview-hint">
              以下为注入下游 Agent 的执行说明（变量已用示例值替换）。
            </Typography.Text>
            <pre className="app-workflow-code-edit-modal__preview-body">{previewText}</pre>
          </div>
        ) : null}
      </Form>
    </Modal>
  );
}
