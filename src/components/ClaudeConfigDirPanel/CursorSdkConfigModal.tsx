import { KeyOutlined, LinkOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Space, Typography, message } from "antd";
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
      setSaving(true);
      await setCursorApiKey(values.apiKey);
      await probeCursorAgent();
      if (!aliveRef.current) return;
      message.success("Cursor API Key 已保存");
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
      if (next.available) {
        message.success("Cursor SDK 已就绪");
      } else {
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
      message.success("Cursor API Key 已清除");
      await loadStatus();
      await onSaved?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, [form, loadStatus, onSaved]);

  return (
    <Modal
      title="配置 Cursor SDK"
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          关闭
        </Button>,
        status?.apiKeyConfigured ? (
          <Button key="clear" danger loading={saving} onClick={() => void handleClear()}>
            清除 Key
          </Button>
        ) : null,
        <Button key="probe" loading={probing} onClick={() => void handleProbe()}>
          重新探测
        </Button>,
        <Button key="save" type="primary" loading={saving} onClick={() => void handleSave()}>
          保存 Key
        </Button>,
      ]}
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        Cursor SDK 通过 Bun sidecar 运行 Local Agent。请在
        {" "}
        <Typography.Link
          href="https://cursor.com/cn/dashboard/api?section=user-keys#user-api-keys"
          target="_blank"
          rel="noreferrer"
        >
          Cursor Dashboard → API Keys
          <LinkOutlined style={{ marginInlineStart: 4 }} />
        </Typography.Link>
        {" "}
        创建 User API Key，并保存在本机 Wise 数据库中（不会写入前端 localStorage）。
      </Typography.Paragraph>

      <Form form={form} layout="vertical">
        <Form.Item
          name="apiKey"
          label="Cursor API Key"
          rules={[{ required: true, message: "请输入 Cursor API Key" }]}
        >
          <Input.Password
            prefix={<KeyOutlined />}
            placeholder="cursor_..."
            autoComplete="off"
          />
        </Form.Item>
      </Form>

      {status ? (
        <Alert
          type={status.available ? "success" : status.apiKeyConfigured ? "warning" : "info"}
          showIcon
          title={status.available ? "Cursor SDK 已就绪" : "Cursor SDK 待配置"}
          description={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              <StatusLine label="Bun" ok={status.bunAvailable} />
              <StatusLine label="Bridge 脚本" ok={status.bridgeAvailable} />
              <StatusLine label="@cursor/sdk" ok={status.sdkAvailable} />
              <StatusLine label="API Key" ok={status.apiKeyConfigured} />
              {status.apiKeyValid != null ? (
                <StatusLine label="Key 校验" ok={status.apiKeyValid} />
              ) : null}
              {!status.available && status.failureReason ? (
                <Typography.Text type="secondary">{status.failureReason}</Typography.Text>
              ) : null}
            </Space>
          }
        />
      ) : null}

      {loadingStatus ? (
        <Typography.Text type="secondary">
          <ReloadOutlined spin style={{ marginInlineEnd: 6 }} />
          正在读取 Cursor SDK 状态…
        </Typography.Text>
      ) : null}
    </Modal>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <Typography.Text type={ok ? "success" : "secondary"}>
      {ok ? "✓" : "○"} {label}
    </Typography.Text>
  );
}
