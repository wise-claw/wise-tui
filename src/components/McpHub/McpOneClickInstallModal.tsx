import { App, Form, Input, Modal, Select } from "antd";
import { useCallback, useEffect, useState } from "react";
import { addClaudeMcpServer } from "../../services/claude";
import type { RecommendedMcp } from "./recommendedMcps";
import type { ClaudeMcpAddPayload } from "../../types";

interface Props {
  open: boolean;
  onClose: () => void;
  mcp: RecommendedMcp | null;
  repositoryPath?: string | null;
  onInstalled: () => void | Promise<void>;
}

export function McpOneClickInstallModal({ open, onClose, mcp, repositoryPath, onInstalled }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !mcp) return;

    // Build initial form values
    const initialValues: Record<string, string> = {};
    if (mcp.envVars) {
      for (const ev of mcp.envVars) {
        if (ev.isPath && repositoryPath) {
          initialValues[ev.name] = repositoryPath;
        } else {
          initialValues[ev.name] = "";
        }
      }
    }

    form.setFieldsValue({
      scope: repositoryPath ? "local" : "user",
      ...initialValues,
    });
  }, [open, mcp, repositoryPath, form]);

  const submit = useCallback(async () => {
    if (!mcp) return;
    const v = await form.validateFields();

    if ((v.scope === "local" || v.scope === "project") && !repositoryPath?.trim()) {
      message.error("当前未打开工作区，无法在 local 范围进行安装");
      return;
    }

    const envPairs: string[] = [];
    const extraArgs: string[] = [];

    if (mcp.envVars) {
      for (const ev of mcp.envVars) {
        const val = (v[ev.name] as string | undefined)?.trim();
        if (ev.required && !val) {
          message.error(`必须输入 ${ev.label}`);
          return;
        }
        if (val) {
          if (ev.isArg) {
            extraArgs.push(val);
          } else {
            envPairs.push(`${ev.name}=${val}`);
          }
        }
      }
    }

    const payload: ClaudeMcpAddPayload = {
      scope: v.scope,
      transport: "stdio",
      name: mcp.name,
      repositoryPath: repositoryPath ?? null,
      url: null,
      command: mcp.command,
      args: [...mcp.args, ...extraArgs],
      headers: null,
      envPairs: envPairs.length > 0 ? envPairs : null,
    };

    setSubmitting(true);
    try {
      await addClaudeMcpServer(payload);
      onClose();
      await onInstalled();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }, [form, mcp, message, repositoryPath, onInstalled, onClose]);

  if (!mcp) return null;

  return (
    <Modal
      title={`安装 MCP: ${mcp.name}`}
      open={open}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={submitting}
      destroyOnHidden
      width={420}
      wrapClassName="app-mcp-add-modal"
    >
      <div style={{ marginBottom: 16, fontSize: 12, color: "var(--ant-color-text-secondary)" }}>
        {mcp.description}
      </div>

      <Form form={form} layout="vertical" size="small" colon={false}>
        <Form.Item name="scope" label="安装范围" rules={[{ required: true, message: "请选择范围" }]}>
          <Select
            size="small"
            popupMatchSelectWidth={false}
            options={[
              { value: "user", label: "user · 本机全部工作区（全局生效）" },
              ...(repositoryPath
                ? [
                    { value: "local", label: "local · 仅本仓库工作区（不提交 Git）" },
                    { value: "project", label: "project · 团队共享工作区 (.mcp.json)" },
                  ]
                : []),
            ]}
          />
        </Form.Item>

        {mcp.envVars?.map((ev) => (
          <Form.Item
            key={ev.name}
            name={ev.name}
            label={ev.label}
            rules={[{ required: ev.required, message: `请输入 ${ev.label}` }]}
          >
            <Input size="small" placeholder={ev.placeholder} autoComplete="off" />
          </Form.Item>
        ))}

        <div style={{ marginTop: 12, fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
          <div>安装类型：<strong>stdio (标准输入输出)</strong></div>
          <div>即将执行的命令：<code>{`${mcp.command} ${mcp.args.join(" ")}`}</code></div>
        </div>
      </Form>
    </Modal>
  );
}
