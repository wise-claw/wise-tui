import { App, Form, Input, Modal, Radio, Select } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { ClaudeMcpAddPayload } from "../../types";
import { addClaudeMcpServer } from "../../services/claude";
import "../ClaudeMcpLayout.css";

interface Props {
  open: boolean;
  onClose: () => void;
  repositoryPath?: string | null;
  onAdded: () => void | Promise<void>;
}

export function ClaudeMcpAddServerModal({ open, onClose, repositoryPath, onAdded }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    scope: ClaudeMcpAddPayload["scope"];
    transport: ClaudeMcpAddPayload["transport"];
    name: string;
    url?: string;
    command?: string;
    argsText?: string;
    headersText?: string;
    envText?: string;
  }>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      scope: repositoryPath ? "local" : "user",
      transport: "http",
      name: "",
      url: "",
      command: "",
      argsText: "",
      headersText: "",
      envText: "",
    });
  }, [open, form, repositoryPath]);

  const submit = useCallback(async () => {
    const v = await form.validateFields();
    if ((v.scope === "local" || v.scope === "project") && !repositoryPath?.trim()) {
      message.error("当前未打开仓库目录，无法使用 local / project 范围");
      return;
    }
    const headers = v.headersText
      ?.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const envPairs = v.envText
      ?.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const args = v.argsText
      ?.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const payload: ClaudeMcpAddPayload = {
      scope: v.scope,
      transport: v.transport,
      name: v.name.trim(),
      repositoryPath: repositoryPath ?? null,
      url: v.transport === "stdio" ? null : v.url?.trim() || null,
      command: v.transport === "stdio" ? v.command?.trim() || null : null,
      args: v.transport === "stdio" && args?.length ? args : null,
      headers: headers?.length ? headers : null,
      envPairs: envPairs?.length ? envPairs : null,
    };

    setSubmitting(true);
    try {
      await addClaudeMcpServer(payload);
      message.success("已添加 MCP");
      onClose();
      await onAdded();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [form, message, onAdded, onClose, repositoryPath]);

  return (
    <Modal
      title="添加 MCP"
      open={open}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={submitting}
      destroyOnHidden
      width={380}
      wrapClassName="app-mcp-add-modal"
    >
      <Form form={form} layout="vertical" size="small" className="app-mcp-add-form" colon={false}>
        <Form.Item name="scope" label="范围" rules={[{ required: true, message: "请选择范围" }]}>
          <Select
            size="small"
            popupMatchSelectWidth={false}
            options={[
              { value: "user", label: "user · 本机全部工作区" },
              { value: "local", label: "local · 仅本仓库" },
              { value: "project", label: "project · .mcp.json" },
            ]}
          />
        </Form.Item>
        <Form.Item name="transport" label="传输" rules={[{ required: true, message: "请选择传输类型" }]}>
          <Radio.Group size="small" className="app-mcp-add-transport">
            <Radio.Button value="http">HTTP</Radio.Button>
            <Radio.Button value="sse">SSE</Radio.Button>
            <Radio.Button value="stdio">stdio</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "填写 MCP 名称（字母数字 ._-）" }]}>
          <Input size="small" placeholder="如 github" autoComplete="off" />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(p, c) => p.transport !== c.transport}>
          {({ getFieldValue }) =>
            getFieldValue("transport") === "stdio" ? (
              <>
                <Form.Item name="command" label="命令" rules={[{ required: true, message: "例如 npx" }]}>
                  <Input size="small" placeholder="npx" />
                </Form.Item>
                <Form.Item name="argsText" label="参数（每行一项）">
                  <Input.TextArea size="small" rows={2} placeholder={"-y\n@pkg/mcp"} />
                </Form.Item>
              </>
            ) : (
              <Form.Item name="url" label="URL" rules={[{ required: true, message: "填写 MCP URL" }]}>
                <Input size="small" placeholder="https://…" />
              </Form.Item>
            )
          }
        </Form.Item>
        <Form.Item name="headersText" label="HTTP 头（可选）">
          <Input.TextArea size="small" rows={2} placeholder="每行 Key: Value" />
        </Form.Item>
        <Form.Item name="envText" label="环境变量（可选）">
          <Input.TextArea size="small" rows={2} placeholder="每行 KEY=value · stdio" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
