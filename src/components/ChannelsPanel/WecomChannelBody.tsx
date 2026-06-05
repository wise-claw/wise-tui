import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Select, Space, Typography, message } from "antd";
import { ExperimentOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";
import {
  loadWecomConfig,
  saveWecomConfig,
  wecomWebhookSend,
  wecomWebhookTest,
  type WecomWebhookConfig,
  type ChannelSendResult,
} from "../../services/remoteChannels";

interface WecomChannelBodyProps {
  onConfiguredChange?: (configured: boolean) => void;
}

function describeResult(result: ChannelSendResult): string {
  if (result.ok) return "已发送成功";
  const parts = [] as string[];
  if (result.code) parts.push(`errcode=${result.code}`);
  if (result.message) parts.push(result.message);
  return parts.length > 0 ? parts.join(" · ") : "发送失败";
}

export function WecomChannelBody({ onConfiguredChange }: WecomChannelBodyProps) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [defaultMsgType, setDefaultMsgType] = useState<"text" | "markdown">("markdown");
  const [debugContent, setDebugContent] = useState("**Wise 测试**\n这是一条联通性消息");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<WecomWebhookConfig | null>(null);

  const hasUrl = webhookUrl.trim().length > 0;

  useEffect(() => {
    void (async () => {
      const cfg = await loadWecomConfig();
      if (!cfg) {
        onConfiguredChange?.(false);
        return;
      }
      setLoaded(cfg);
      setWebhookUrl(cfg.webhookUrl ?? "");
      setDefaultMsgType(cfg.defaultMsgType ?? "markdown");
      onConfiguredChange?.(Boolean(cfg.webhookUrl?.trim()));
    })();
  }, [onConfiguredChange]);

  const dirty = useMemo(() => {
    if (!loaded) return hasUrl;
    return (
      (loaded.webhookUrl ?? "") !== webhookUrl ||
      (loaded.defaultMsgType ?? "markdown") !== defaultMsgType
    );
  }, [defaultMsgType, hasUrl, loaded, webhookUrl]);

  const handleSave = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写企业微信 Webhook URL");
      return;
    }
    setSaving(true);
    try {
      const next: WecomWebhookConfig = {
        webhookUrl: webhookUrl.trim(),
        defaultMsgType,
      };
      await saveWecomConfig(next);
      setLoaded(next);
      onConfiguredChange?.(true);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [defaultMsgType, hasUrl, onConfiguredChange, webhookUrl]);

  const handleTest = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写企业微信 Webhook URL");
      return;
    }
    setTesting(true);
    try {
      const result = await wecomWebhookTest(webhookUrl.trim());
      setLastResult(describeResult(result));
      if (!result.ok) void message.error(describeResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(msg);
      void message.error(msg);
    } finally {
      setTesting(false);
    }
  }, [hasUrl, webhookUrl]);

  const handleSend = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写企业微信 Webhook URL");
      return;
    }
    if (!debugContent.trim()) {
      void message.warning("请填写发送内容");
      return;
    }
    setSending(true);
    try {
      const result = await wecomWebhookSend({
        webhookUrl: webhookUrl.trim(),
        msgType: defaultMsgType,
        content: debugContent,
      });
      setLastResult(describeResult(result));
      if (!result.ok) void message.error(describeResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(msg);
      void message.error(msg);
    } finally {
      setSending(false);
    }
  }, [debugContent, defaultMsgType, hasUrl, webhookUrl]);

  return (
    <div className="app-channels-body app-channels-body--wecom">
      <Alert
        type="info"
        showIcon
        message="企业微信群机器人 Webhook"
        description={
          <span>
            群设置 → 添加群机器人 → 复制 Webhook 地址。当前仅支持单向通知（text / markdown），
            「应用号 / 自建应用」双向接入将在后续 PR 提供（需 CorpID + Secret + AgentID）。
          </span>
        }
      />
      <div className="app-channels-body__form">
        <label className="app-channels-body__field">
          <span>Webhook URL</span>
          <Input
            allowClear
            size="small"
            placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </label>
        <label className="app-channels-body__field">
          <span>默认消息类型</span>
          <Select
            size="small"
            value={defaultMsgType}
            onChange={(value) => setDefaultMsgType(value)}
            options={[
              { value: "markdown", label: "Markdown" },
              { value: "text", label: "纯文本" },
            ]}
          />
        </label>
      </div>
      <Space wrap size={6} className="app-channels-body__actions">
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty}
          onClick={() => void handleSave()}
        >
          保存配置
        </Button>
        <Button
          size="small"
          icon={<ExperimentOutlined />}
          loading={testing}
          disabled={!hasUrl}
          onClick={() => void handleTest()}
        >
          联通性测试
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={async () => {
            const cfg = await loadWecomConfig();
            if (cfg) {
              setLoaded(cfg);
              setWebhookUrl(cfg.webhookUrl ?? "");
              setDefaultMsgType(cfg.defaultMsgType ?? "markdown");
              onConfiguredChange?.(Boolean(cfg.webhookUrl?.trim()));
            }
          }}
        >
          重新加载
        </Button>
      </Space>
      <div className="app-channels-body__debug">
        <label className="app-channels-body__field">
          <span>调试内容</span>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            value={debugContent}
            onChange={(e) => setDebugContent(e.target.value)}
          />
        </label>
        <Button
          size="small"
          icon={<SendOutlined />}
          loading={sending}
          disabled={!hasUrl}
          onClick={() => void handleSend()}
        >
          发送到企业微信
        </Button>
      </div>
      {lastResult ? (
        <Typography.Text type="secondary" className="app-channels-body__result">
          上次结果：{lastResult}
        </Typography.Text>
      ) : null}
    </div>
  );
}
