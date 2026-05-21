import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Select, Space, Typography, message } from "antd";
import { ExperimentOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from "@ant-design/icons";
import {
  loadTelegramConfig,
  saveTelegramConfig,
  telegramBotSendMessage,
  telegramBotTest,
  type TelegramBotConfig,
  type ChannelSendResult,
} from "../../services/remoteChannels";

interface TelegramChannelBodyProps {
  onConfiguredChange?: (configured: boolean) => void;
}

function describeResult(result: ChannelSendResult): string {
  if (result.ok) return "已发送成功";
  const parts = [] as string[];
  if (result.code) parts.push(`error_code=${result.code}`);
  if (result.message) parts.push(result.message);
  return parts.length > 0 ? parts.join(" · ") : "发送失败";
}

export function TelegramChannelBody({ onConfiguredChange }: TelegramChannelBodyProps) {
  const [botToken, setBotToken] = useState("");
  const [defaultChatId, setDefaultChatId] = useState("");
  const [parseMode, setParseMode] = useState<"Markdown" | "MarkdownV2" | "HTML">("Markdown");
  const [debugContent, setDebugContent] = useState("Wise 联通性测试");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<TelegramBotConfig | null>(null);

  const hasToken = botToken.trim().length > 0;
  const hasChatId = defaultChatId.trim().length > 0;

  useEffect(() => {
    void (async () => {
      const cfg = await loadTelegramConfig();
      if (!cfg) {
        onConfiguredChange?.(false);
        return;
      }
      setLoaded(cfg);
      setBotToken(cfg.botToken ?? "");
      setDefaultChatId(cfg.defaultChatId ?? "");
      setParseMode(cfg.defaultParseMode ?? "Markdown");
      onConfiguredChange?.(Boolean(cfg.botToken?.trim()));
    })();
  }, [onConfiguredChange]);

  const dirty = useMemo(() => {
    if (!loaded) return hasToken;
    return (
      (loaded.botToken ?? "") !== botToken ||
      (loaded.defaultChatId ?? "") !== defaultChatId ||
      (loaded.defaultParseMode ?? "Markdown") !== parseMode
    );
  }, [botToken, defaultChatId, hasToken, loaded, parseMode]);

  const handleSave = useCallback(async () => {
    if (!hasToken) {
      void message.warning("请先填写 Bot Token");
      return;
    }
    setSaving(true);
    try {
      const next: TelegramBotConfig = {
        botToken: botToken.trim(),
        defaultChatId: defaultChatId.trim() || undefined,
        defaultParseMode: parseMode,
      };
      await saveTelegramConfig(next);
      setLoaded(next);
      onConfiguredChange?.(true);
      void message.success("Telegram 配置已保存");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [botToken, defaultChatId, hasToken, onConfiguredChange, parseMode]);

  const handleTest = useCallback(async () => {
    if (!hasToken) {
      void message.warning("请先填写 Bot Token");
      return;
    }
    setTesting(true);
    try {
      const result = await telegramBotTest(botToken.trim());
      setLastResult(describeResult(result));
      if (result.ok) {
        const username = (result.raw as { result?: { username?: string } })?.result?.username;
        void message.success(username ? `getMe 成功：@${username}` : "getMe 成功");
      } else {
        void message.error(describeResult(result));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(msg);
      void message.error(msg);
    } finally {
      setTesting(false);
    }
  }, [botToken, hasToken]);

  const handleSend = useCallback(async () => {
    if (!hasToken) {
      void message.warning("请先填写 Bot Token");
      return;
    }
    if (!hasChatId) {
      void message.warning("请先填写默认 chat_id");
      return;
    }
    if (!debugContent.trim()) {
      void message.warning("请填写发送内容");
      return;
    }
    setSending(true);
    try {
      const result = await telegramBotSendMessage({
        botToken: botToken.trim(),
        chatId: defaultChatId.trim(),
        text: debugContent,
        parseMode,
      });
      setLastResult(describeResult(result));
      if (result.ok) void message.success("已发送");
      else void message.error(describeResult(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(msg);
      void message.error(msg);
    } finally {
      setSending(false);
    }
  }, [botToken, debugContent, defaultChatId, hasChatId, hasToken, parseMode]);

  return (
    <div className="app-channels-body app-channels-body--telegram">
      <Alert
        type="info"
        showIcon
        message="Telegram Bot sendMessage"
        description={
          <span>
            在 @BotFather 创建机器人后获得 Bot Token。chat_id 可在 @userinfobot
            获取（个人）或群组里加入机器人后用 getUpdates 查看。本机直连
            api.telegram.org，需保证可访问 Telegram；Webhook 接入（双向）会在后续 PR 落地。
          </span>
        }
      />
      <div className="app-channels-body__form">
        <label className="app-channels-body__field">
          <span>Bot Token</span>
          <Input.Password
            allowClear
            size="small"
            autoComplete="off"
            placeholder="1234567890:AAEx……"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
          />
        </label>
        <div className="app-channels-body__row">
          <label className="app-channels-body__field">
            <span>默认 chat_id</span>
            <Input
              allowClear
              size="small"
              placeholder="@channel 或 数字 ID"
              value={defaultChatId}
              onChange={(e) => setDefaultChatId(e.target.value)}
            />
          </label>
          <label className="app-channels-body__field">
            <span>默认 parse_mode</span>
            <Select
              size="small"
              value={parseMode}
              onChange={(value) => setParseMode(value)}
              options={[
                { value: "Markdown", label: "Markdown" },
                { value: "MarkdownV2", label: "MarkdownV2" },
                { value: "HTML", label: "HTML" },
              ]}
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
          disabled={!hasToken}
          onClick={() => void handleTest()}
        >
          getMe 测试
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={async () => {
            const cfg = await loadTelegramConfig();
            if (cfg) {
              setLoaded(cfg);
              setBotToken(cfg.botToken ?? "");
              setDefaultChatId(cfg.defaultChatId ?? "");
              setParseMode(cfg.defaultParseMode ?? "Markdown");
              onConfiguredChange?.(Boolean(cfg.botToken?.trim()));
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
          disabled={!hasToken || !hasChatId}
          onClick={() => void handleSend()}
        >
          发送 sendMessage
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
