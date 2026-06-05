import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Select, Space, Typography, message } from "antd";
import { ExperimentOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";
import {
  feishuWebhookSend,
  feishuWebhookTest,
  loadFeishuConfig,
  saveFeishuConfig,
  type FeishuWebhookConfig,
  type ChannelSendResult,
} from "../../services/remoteChannels";

interface FeishuChannelBodyProps {
  /** 父组件通过此回调感知「已配置」状态变化，用于渠道卡片标签更新 */
  onConfiguredChange?: (configured: boolean) => void;
}

function describeResult(result: ChannelSendResult): string {
  if (result.ok) return "已发送成功";
  const parts = [] as string[];
  if (result.code) parts.push(`code=${result.code}`);
  if (result.message) parts.push(result.message);
  return parts.length > 0 ? parts.join(" · ") : "发送失败";
}

export function FeishuChannelBody({ onConfiguredChange }: FeishuChannelBodyProps) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [defaultMsgType, setDefaultMsgType] = useState<"text" | "post">("text");
  const [defaultTitle, setDefaultTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [debugContent, setDebugContent] = useState("Wise 测试消息");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<FeishuWebhookConfig | null>(null);

  const hasUrl = webhookUrl.trim().length > 0;

  useEffect(() => {
    void (async () => {
      const cfg = await loadFeishuConfig();
      if (!cfg) {
        onConfiguredChange?.(false);
        return;
      }
      setLoaded(cfg);
      setWebhookUrl(cfg.webhookUrl ?? "");
      setSecret(cfg.secret ?? "");
      setDefaultMsgType(cfg.defaultMsgType ?? "text");
      setDefaultTitle(cfg.defaultTitle ?? "");
      onConfiguredChange?.(Boolean(cfg.webhookUrl?.trim()));
    })();
  }, [onConfiguredChange]);

  const dirty = useMemo(() => {
    if (!loaded) return hasUrl;
    return (
      (loaded.webhookUrl ?? "") !== webhookUrl ||
      (loaded.secret ?? "") !== secret ||
      (loaded.defaultMsgType ?? "text") !== defaultMsgType ||
      (loaded.defaultTitle ?? "") !== defaultTitle
    );
  }, [defaultMsgType, defaultTitle, hasUrl, loaded, secret, webhookUrl]);

  const handleSave = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写飞书 Webhook URL");
      return;
    }
    setSaving(true);
    try {
      const next: FeishuWebhookConfig = {
        webhookUrl: webhookUrl.trim(),
        secret: secret.trim() || undefined,
        defaultMsgType,
        defaultTitle: defaultTitle.trim() || undefined,
      };
      await saveFeishuConfig(next);
      setLoaded(next);
      onConfiguredChange?.(true);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [defaultMsgType, defaultTitle, hasUrl, onConfiguredChange, secret, webhookUrl]);

  const handleTest = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写飞书 Webhook URL");
      return;
    }
    setTesting(true);
    try {
      const result = await feishuWebhookTest({
        webhookUrl: webhookUrl.trim(),
        secret: secret.trim() || null,
      });
      setLastResult(describeResult(result));
      if (!result.ok) void message.error(describeResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(msg);
      void message.error(msg);
    } finally {
      setTesting(false);
    }
  }, [hasUrl, secret, webhookUrl]);

  const handleSend = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写飞书 Webhook URL");
      return;
    }
    if (!debugContent.trim()) {
      void message.warning("请填写发送内容");
      return;
    }
    setSending(true);
    try {
      const result = await feishuWebhookSend({
        webhookUrl: webhookUrl.trim(),
        secret: secret.trim() || null,
        msgType: defaultMsgType,
        content: debugContent,
        title: defaultMsgType === "post" ? (defaultTitle.trim() || null) : null,
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
  }, [debugContent, defaultMsgType, defaultTitle, hasUrl, secret, webhookUrl]);

  return (
    <div className="app-channels-body app-channels-body--feishu">
      <Alert
        type="info"
        showIcon
        message="自建机器人 Webhook"
        description={
          <span>
            在群里 → 设置 → 群机器人 → 添加机器人 → 自定义。可选启用「签名校验」，secret 与
            URL 配对使用；目前仅支持单向通知（text / post），双向消息接入后续 PR。
          </span>
        }
      />
      <div className="app-channels-body__form">
        <label className="app-channels-body__field">
          <span>Webhook URL</span>
          <Input
            allowClear
            size="small"
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </label>
        <label className="app-channels-body__field">
          <span>签名校验 secret（可选）</span>
          <Input.Password
            allowClear
            size="small"
            autoComplete="off"
            placeholder="启用「签名校验」时必填"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <div className="app-channels-body__row">
          <label className="app-channels-body__field">
            <span>默认消息类型</span>
            <Select
              size="small"
              value={defaultMsgType}
              onChange={(value) => setDefaultMsgType(value)}
              options={[
                { value: "text", label: "纯文本 text" },
                { value: "post", label: "富文本 post" },
              ]}
            />
          </label>
          <label className="app-channels-body__field">
            <span>post 默认标题</span>
            <Input
              allowClear
              size="small"
              placeholder="可选；post 类型时使用"
              disabled={defaultMsgType !== "post"}
              value={defaultTitle}
              onChange={(e) => setDefaultTitle(e.target.value)}
            />
          </label>
        </div>
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
            const cfg = await loadFeishuConfig();
            if (cfg) {
              setLoaded(cfg);
              setWebhookUrl(cfg.webhookUrl ?? "");
              setSecret(cfg.secret ?? "");
              setDefaultMsgType(cfg.defaultMsgType ?? "text");
              setDefaultTitle(cfg.defaultTitle ?? "");
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
            placeholder="将以当前默认类型发送"
          />
        </label>
        <Button
          type="default"
          size="small"
          icon={<SendOutlined />}
          loading={sending}
          disabled={!hasUrl}
          onClick={() => void handleSend()}
        >
          发送到飞书
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
