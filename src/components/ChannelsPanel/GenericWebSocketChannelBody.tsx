import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Space, Tag, Typography, message } from "antd";
import {
  PoweroffOutlined,
  ReloadOutlined,
  SaveOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  genericWsSendText,
  genericWsStart,
  genericWsStatus,
  genericWsStop,
  loadGenericWsConfig,
  saveGenericWsConfig,
  type GenericWebSocketConfig,
  type GenericWsInboundEvent,
  type GenericWsStatus,
} from "../../services/remoteChannels";

interface GenericWebSocketChannelBodyProps {
  onConfiguredChange?: (configured: boolean) => void;
  onStatusChange?: (status: GenericWsStatus) => void;
}

function phaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "stopped":
    default:
      return "未运行";
  }
}

function phaseColor(status: GenericWsStatus): "success" | "processing" | "error" | "default" {
  if (status.lastError && !status.running) return "error";
  if (status.phase === "connected") return "success";
  if (status.phase === "connecting" || status.phase === "reconnecting") return "processing";
  return "default";
}

function formatTime(value?: string | null): string {
  if (!value) return "无";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(ts);
}

const MAX_INBOUND_LOG = 50;

export function GenericWebSocketChannelBody({
  onConfiguredChange,
  onStatusChange,
}: GenericWebSocketChannelBodyProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [protocol, setProtocol] = useState("");
  const [debugContent, setDebugContent] = useState('{"type":"ping","ts":' + Date.now() + "}");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<GenericWsStatus>({ running: false, phase: "stopped" });
  const [inboundLog, setInboundLog] = useState<GenericWsInboundEvent[]>([]);
  const [loaded, setLoaded] = useState<GenericWebSocketConfig | null>(null);

  const hasUrl = url.trim().length > 0;

  useEffect(() => {
    void (async () => {
      const cfg = await loadGenericWsConfig();
      if (cfg) {
        setLoaded(cfg);
        setUrl(cfg.url ?? "");
        setToken(cfg.bearerToken ?? "");
        setProtocol(cfg.protocol ?? "");
        onConfiguredChange?.(Boolean(cfg.url?.trim()));
      } else {
        onConfiguredChange?.(false);
      }
      try {
        const live = await genericWsStatus();
        setStatus(live);
        onStatusChange?.(live);
      } catch {
        /* ignore */
      }
    })();
  }, [onConfiguredChange, onStatusChange]);

  useEffect(() => {
    let statusUnlisten: UnlistenFn | null = null;
    let messageUnlisten: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      const u1 = await listen<GenericWsStatus>("wise:generic-ws:status", (event) => {
        setStatus(event.payload);
        onStatusChange?.(event.payload);
      });
      if (cancelled) {
        u1();
        return;
      }
      statusUnlisten = u1;

      const u2 = await listen<GenericWsInboundEvent>("wise:generic-ws:message", (event) => {
        setInboundLog((prev) => {
          const next = [event.payload, ...prev];
          return next.slice(0, MAX_INBOUND_LOG);
        });
      });
      if (cancelled) {
        u2();
        return;
      }
      messageUnlisten = u2;
    })();
    return () => {
      cancelled = true;
      statusUnlisten?.();
      messageUnlisten?.();
    };
  }, [onStatusChange]);

  const dirty = useMemo(() => {
    if (!loaded) return hasUrl;
    return (
      (loaded.url ?? "") !== url ||
      (loaded.bearerToken ?? "") !== token ||
      (loaded.protocol ?? "") !== protocol
    );
  }, [hasUrl, loaded, protocol, token, url]);

  const handleSave = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写 WebSocket URL");
      return;
    }
    setSaving(true);
    try {
      const next: GenericWebSocketConfig = {
        url: url.trim(),
        bearerToken: token.trim() || undefined,
        protocol: protocol.trim() || undefined,
      };
      await saveGenericWsConfig(next);
      setLoaded(next);
      onConfiguredChange?.(true);
      void message.success("WebSocket 配置已保存");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [hasUrl, onConfiguredChange, protocol, token, url]);

  const handleStart = useCallback(async () => {
    if (!hasUrl) {
      void message.warning("请先填写 WebSocket URL");
      return;
    }
    setBusy(true);
    try {
      const next = await genericWsStart({
        url: url.trim(),
        bearerToken: token.trim() || undefined,
        protocol: protocol.trim() || undefined,
      });
      setStatus(next);
      onStatusChange?.(next);
      void message.success("WebSocket 已启动");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "启动失败");
    } finally {
      setBusy(false);
    }
  }, [hasUrl, onStatusChange, protocol, token, url]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      const next = await genericWsStop();
      setStatus(next);
      onStatusChange?.(next);
      void message.success("WebSocket 已停止");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "停止失败");
    } finally {
      setBusy(false);
    }
  }, [onStatusChange]);

  const handleSend = useCallback(async () => {
    if (!status.running) {
      void message.warning("WebSocket 未运行，无法发送");
      return;
    }
    if (!debugContent.trim()) {
      void message.warning("请填写发送内容");
      return;
    }
    try {
      await genericWsSendText(debugContent);
      void message.success("已发送一帧");
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "发送失败");
    }
  }, [debugContent, status.running]);

  return (
    <div className="app-channels-body app-channels-body--generic-ws">
      <Alert
        type="info"
        showIcon
        message="通用 WebSocket 客户端"
        description={
          <span>
            Wise 会作为客户端连到指定 ws/wss URL，可选附加 Bearer Token / 子协议。收到的文本帧会在
            下面实时显示，方便对接自建网关；服务端模式（开本机端口让外部接入）会在后续 PR 提供。
          </span>
        }
      />
      <div className="app-channels-panel__ops">
        <div className="app-channels-panel__ops-head">
          <div>
            <Typography.Text strong>WebSocket 网关</Typography.Text>
            <div className="app-channels-panel__ops-subtitle">客户端长连接</div>
          </div>
          <Tag color={phaseColor(status)}>{phaseLabel(status.phase)}</Tag>
        </div>
        <div className="app-channels-panel__metrics">
          <span>启动：{formatTime(status.startedAt)}</span>
          <span>连接：{formatTime(status.connectedAt)}</span>
          <span>入站：{formatTime(status.lastInboundAt)}</span>
          <span>停止：{formatTime(status.lastStoppedAt)}</span>
        </div>
        {status.lastError ? (
          <Typography.Text type="danger" className="app-channels-panel__error">
            最近错误：{status.lastError}（{formatTime(status.lastErrorAt)}）
          </Typography.Text>
        ) : null}
        <Space wrap className="app-channels-panel__ops-actions">
          <Button
            type="primary"
            size="small"
            icon={<PoweroffOutlined />}
            loading={busy}
            disabled={!hasUrl || status.running}
            onClick={() => void handleStart()}
          >
            启动
          </Button>
          <Button
            size="small"
            icon={<StopOutlined />}
            loading={busy}
            disabled={!status.running}
            onClick={() => void handleStop()}
          >
            停止
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={async () => {
              const live = await genericWsStatus();
              setStatus(live);
              onStatusChange?.(live);
            }}
          >
            刷新
          </Button>
        </Space>
      </div>

      <div className="app-channels-body__form">
        <label className="app-channels-body__field">
          <span>WebSocket URL</span>
          <Input
            allowClear
            size="small"
            placeholder="wss://example.com/ws"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <div className="app-channels-body__row">
          <label className="app-channels-body__field">
            <span>Bearer Token（可选）</span>
            <Input.Password
              allowClear
              size="small"
              autoComplete="off"
              placeholder="作为 Authorization: Bearer ... 发送"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label className="app-channels-body__field">
            <span>Sec-WebSocket-Protocol（可选）</span>
            <Input
              allowClear
              size="small"
              placeholder="例如 mqtt 或 自定义子协议"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
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
      </Space>

      <div className="app-channels-body__debug">
        <label className="app-channels-body__field">
          <span>发送文本帧</span>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 5 }}
            value={debugContent}
            onChange={(e) => setDebugContent(e.target.value)}
          />
        </label>
        <Button
          size="small"
          icon={<SendOutlined />}
          disabled={!status.running}
          onClick={() => void handleSend()}
        >
          发送一帧
        </Button>
      </div>

      <div className="app-channels-body__inbound">
        <Typography.Text strong>最近入站（仅保留 {MAX_INBOUND_LOG} 条）</Typography.Text>
        {inboundLog.length === 0 ? (
          <Typography.Text type="secondary">尚未收到消息</Typography.Text>
        ) : (
          <ul className="app-channels-body__inbound-list">
            {inboundLog.map((item, idx) => (
              <li key={`${item.at}-${idx}`}>
                <span className="app-channels-body__inbound-time">{formatTime(item.at)}</span>
                <span className="app-channels-body__inbound-kind">{item.kind}</span>
                <span className="app-channels-body__inbound-text">
                  {item.kind === "text"
                    ? item.text ?? ""
                    : `[binary ${item.binarySize ?? 0} bytes]`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
