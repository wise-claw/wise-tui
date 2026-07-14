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
      setSaving(true);
      await setCursorApiKey(values.apiKey);
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
      if (next.available) {
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
        { label: "Bun", ok: status.bunAvailable },
        { label: "Bridge 脚本", ok: status.bridgeAvailable },
        { label: "@cursor/sdk", ok: status.sdkAvailable },
        ...(status.sdkPackageInstalled != null
          ? [{ label: "SDK 依赖目录", ok: status.sdkPackageInstalled }]
          : []),
        { label: "API Key", ok: status.apiKeyConfigured },
        ...(status.apiKeyValid != null ? [{ label: "Key 校验", ok: status.apiKeyValid }] : []),
        ...(status.filesystemAccessOk != null
          ? [{ label: "子进程文件读写", ok: status.filesystemAccessOk }]
          : []),
        ...(status.repositoryReadOk != null
          ? [{ label: "目标仓库可读", ok: status.repositoryReadOk }]
          : []),
        ...(status.repositoryWriteOk != null
          ? [{ label: "目标仓库可写", ok: status.repositoryWriteOk }]
          : []),
        ...(status.toolsAvailable != null
          ? [{ label: "本地读盘/搜索工具", ok: status.toolsAvailable }]
          : []),
      ]
    : [];

  return (
    <Modal
      title="配置 Cursor SDK"
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
        通过 Bun sidecar 运行 Local Agent。请在{" "}
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
        创建 User API Key，保存在 Wise 数据库（非 localStorage）。
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
                默认<strong>不</strong>加载目标仓库 project 设置层，以免沙箱/钩子禁用写盘。需本机已执行{" "}
                <Typography.Text code>bun install</Typography.Text> 的 Wise 目录（或{" "}
                <Typography.Text code>WISE_CURSOR_SDK_ROOT</Typography.Text>
                ）。macOS 请为 Wise 开启「完全磁盘访问权限」。写盘或 SDK 异常时，可在「执行环境」中重新探测 Status。
              </Typography.Paragraph>
            ),
          },
        ]}
      />

      <Form form={form} layout="vertical" size="small" style={{ marginBottom: 8 }}>
        <Form.Item
          name="apiKey"
          label="Cursor API Key"
          style={{ marginBottom: 0 }}
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
          style={{ marginTop: 8, padding: "6px 10px" }}
          title={
            <span style={{ fontSize: 13 }}>
              {status.available ? "Cursor SDK 已就绪" : "Cursor SDK 待配置"}
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
          正在读取 Cursor SDK 状态…
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
