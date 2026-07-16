import { KeyOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Form, Input, Modal, Typography, message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearCursorApiKey,
  describeCursorAgentStatus,
  getCursorAgentStatus,
  probeCursorAgent,
  setCursorApiKey,
  type CursorAgentStatus,
} from "../../services/cursorAgent";

interface CursorSdkConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

export function CursorSdkConfigModal({ open, onClose, onSaved }: CursorSdkConfigModalProps) {
  const [form] = Form.useForm<{ apiKey: string }>();
  const [status, setStatus] = useState<CursorAgentStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const aliveRef = useRef(true);

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const next = await getCursorAgentStatus();
      if (!aliveRef.current) return;
      setStatus(next);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (aliveRef.current) setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!open) return;
    form.resetFields();
    void loadStatus();
    return () => {
      aliveRef.current = false;
    };
  }, [form, loadStatus, open]);

  const handleSave = useCallback(async () => {
    try {
      const values = await form.validateFields();
      const key = values.apiKey?.trim() ?? "";
      setSaving(true);
      if (key) {
        await setCursorApiKey(key);
      }
      await probeCursorAgent();
      if (!aliveRef.current) return;
      await loadStatus();
      await onSaved?.();
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [form, loadStatus, onSaved]);

  const handleProbe = useCallback(async () => {
    setProbing(true);
    try {
      const next = await probeCursorAgent();
      if (!aliveRef.current) return;
      setStatus(next);
      if (!next.available) {
        message.warning(describeCursorAgentStatus(next));
      }
      await onSaved?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (aliveRef.current) setProbing(false);
    }
  }, [onSaved]);

  const handleClear = useCallback(async () => {
    setSaving(true);
    try {
      await clearCursorApiKey();
      if (!aliveRef.current) return;
      form.resetFields();
      await loadStatus();
      await onSaved?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [form, loadStatus, onSaved]);

  const statusLines: Array<{ label: string; ok: boolean }> = status
    ? [
        { label: "agent CLI", ok: status.cliAvailable },
        { label: "已认证", ok: status.authenticated === true || status.available },
        { label: "API Key", ok: status.apiKeyConfigured },
      ]
    : [];

  return (
    <Modal
      title="配置 Cursor CLI"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      width={460}
      styles={{ body: { paddingTop: 12, paddingBottom: 12 } }}
      footer={[
        <Button key="cancel" size="small" onClick={onClose}>
          关闭
        </Button>,
        status?.apiKeyConfigured ? (
          <Button key="clear" size="small" danger loading={saving} onClick={() => void handleClear()}>
            清除 Key
          </Button>
        ) : null,
        <Button key="probe" size="small" loading={probing} onClick={() => void handleProbe()}>
          重新探测
        </Button>,
        <Button key="save" size="small" type="primary" loading={saving} onClick={() => void handleSave()}>
          保存 Key
        </Button>,
      ]}
    >
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8, fontSize: 12, lineHeight: 1.45 }}>
        通过本机{" "}
        <Typography.Text code style={{ fontSize: 12 }}>
          agent
        </Typography.Text>{" "}
        CLI（非交互{" "}
        <Typography.Text code style={{ fontSize: 12 }}>
          -p
        </Typography.Text>
        ）执行。可先运行{" "}
        <Typography.Text code style={{ fontSize: 12 }}>
          agent login
        </Typography.Text>
        ，或在{" "}
        <Typography.Link
          href="https://cursor.com/cn/dashboard/api?section=user-keys#user-api-keys"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12 }}
        >
          Dashboard → API Keys
          <LinkOutlined style={{ marginInlineStart: 2, fontSize: 11 }} />
        </Typography.Link>
        {" "}
        创建 Key 保存在 Wise 数据库。安装：{" "}
        <Typography.Link href="https://cursor.com/cn/docs/cli/overview" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
          Cursor CLI 文档
        </Typography.Link>
        。
      </Typography.Text>

      <Collapse
        size="small"
        bordered={false}
        style={{ marginBottom: 8 }}
        items={[
          {
            key: "help",
            label: <span style={{ fontSize: 12 }}>环境与排查说明</span>,
            children: (
              <Typography.Paragraph
                type="secondary"
                style={{ marginBottom: 0, fontSize: 12, lineHeight: 1.45 }}
              >
                需已安装 Cursor Agent CLI（
                <Typography.Text code>curl https://cursor.com/install -fsS | bash</Typography.Text>
                ）。可用{" "}
                <Typography.Text code>WISE_CURSOR_AGENT_BIN</Typography.Text>{" "}
                指定二进制路径。无头执行使用{" "}
                <Typography.Text code>--force --sandbox disabled --approve-mcps</Typography.Text>
                。macOS 请为 Wise 开启「完全磁盘访问权限」。
                {status?.cliPath ? (
                  <>
                    {" "}
                    当前路径：
                    <Typography.Text code>{status.cliPath}</Typography.Text>
                    {status.cliVersion ? `（${status.cliVersion}）` : null}
                  </>
                ) : null}
              </Typography.Paragraph>
            ),
          },
        ]}
      />

      <Form form={form} layout="vertical" size="small" style={{ marginBottom: 8 }}>
        <Form.Item
          name="apiKey"
          label="Cursor API Key（可选，也可用 agent login）"
          style={{ marginBottom: 0 }}
          rules={[]}
        >
          <Input.Password
            prefix={<KeyOutlined />}
            placeholder="cursor_...（可留空）"
            autoComplete="off"
          />
        </Form.Item>
      </Form>

      {status ? (
        <Alert
          type={status.available ? "success" : status.cliAvailable ? "warning" : "info"}
          showIcon
          style={{ marginTop: 8, padding: "6px 10px" }}
          title={
            <span style={{ fontSize: 13 }}>
              {status.available ? "Cursor CLI 已就绪" : "Cursor CLI 待配置"}
            </span>
          }
          description={
            <div style={{ width: "100%" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "2px 10px",
                }}
              >
                {statusLines.map((line) => (
                  <StatusLine key={line.label} label={line.label} ok={line.ok} />
                ))}
              </div>
              {!status.available && status.failureReason ? (
                <Typography.Text
                  type="secondary"
                  style={{ display: "block", marginTop: 4, fontSize: 12, lineHeight: 1.4 }}
                >
                  {status.failureReason}
                </Typography.Text>
              ) : null}
            </div>
          }
        />
      ) : null}

      {loadingStatus ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
          <ReloadOutlined spin style={{ marginInlineEnd: 4 }} />
          正在读取 Cursor CLI 状态…
        </Typography.Text>
      ) : null}
    </Modal>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Typography.Text type={ok ? "success" : "secondary"} style={{ fontSize: 12, lineHeight: 1.4 }}>
      {ok ? "✓" : "○"} {label}
    </Typography.Text>
  );
}
