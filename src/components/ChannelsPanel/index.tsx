import {
  ApiOutlined,
  CloudServerOutlined,
  DingdingOutlined,
  GatewayOutlined,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Button, Empty, Space, Switch, Tabs, Tag, Typography, message } from "antd";
import { AuthorPanelListShell, AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DingTalkEnterpriseBotPopoverBody } from "../DingTalkEnterpriseBotPopoverBody";
import { loadDingTalkEnterpriseBotConfig } from "../../services/dingtalkEnterpriseBot";
import {
  dingtalkStreamGatewayIsRunning,
  dingtalkStreamGatewayStart,
  dingtalkStreamGatewayStatus,
  dingtalkStreamGatewayStop,
  type DingTalkStreamGatewayStatus,
} from "../../services/dingtalkStreamGateway";
import { genericWsStatus, type GenericWsStatus } from "../../services/remoteChannels";
import { FeishuChannelBody } from "./FeishuChannelBody";
import { WecomChannelBody } from "./WecomChannelBody";
import { TelegramChannelBody } from "./TelegramChannelBody";
import { GenericWebSocketChannelBody } from "./GenericWebSocketChannelBody";
import "./index.css";

type ChannelKey = "dingtalk" | "feishu" | "wecom" | "telegram" | "websocket";

interface ChannelDefinition {
  key: ChannelKey;
  title: string;
  icon: ReactNode;
}

const CHANNELS: ChannelDefinition[] = [
  { key: "dingtalk", title: "钉钉", icon: <DingdingOutlined /> },
  { key: "feishu", title: "飞书", icon: <MessageOutlined /> },
  { key: "wecom", title: "企业微信", icon: <SendOutlined /> },
  { key: "telegram", title: "Telegram", icon: <ApiOutlined /> },
  { key: "websocket", title: "通用 WebSocket", icon: <CloudServerOutlined /> },
];

export function ChannelsPanel() {
  const [activeKey, setActiveKey] = useState<ChannelKey>("dingtalk");

  // 钉钉沿用原有 Stream 网关状态
  const [dingTalkConfigured, setDingTalkConfigured] = useState(false);
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamStatus, setStreamStatus] = useState<DingTalkStreamGatewayStatus | null>(null);
  const [streamBusy, setStreamBusy] = useState(false);

  // 其它渠道的「已配置」状态来自各自 Body 回调
  const [feishuConfigured, setFeishuConfigured] = useState(false);
  const [wecomConfigured, setWecomConfigured] = useState(false);
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [wsConfigured, setWsConfigured] = useState(false);
  const [wsStatus, setWsStatus] = useState<GenericWsStatus>({ running: false, phase: "stopped" });

  const refreshDingtalk = useCallback(async () => {
    const [config, status] = await Promise.all([
      loadDingTalkEnterpriseBotConfig().catch(() => null),
      dingtalkStreamGatewayStatus().catch(async () => {
        const running = await dingtalkStreamGatewayIsRunning().catch(() => false);
        return {
          running,
          phase: running ? "connected" : "stopped",
        } satisfies DingTalkStreamGatewayStatus;
      }),
    ]);
    setDingTalkConfigured(
      Boolean(config?.appKey?.trim() && config.appSecret?.trim() && config.robotCode?.trim()),
    );
    setStreamRunning(status.running);
    setStreamStatus(status);
  }, []);

  useEffect(() => {
    void refreshDingtalk();
    const id = window.setInterval(() => void refreshDingtalk(), 3000);
    return () => window.clearInterval(id);
  }, [refreshDingtalk]);

  // 初次进入页面时主动同步一次通用 WS 真实状态（避免事件流尚未抵达时显示 stopped）
  useEffect(() => {
    void genericWsStatus()
      .then((s) => setWsStatus(s))
      .catch(() => {});
  }, []);

  const handleToggleDingTalk = useCallback(
    async (next: boolean) => {
      if (!dingTalkConfigured) return;
      setStreamBusy(true);
      try {
        if (next) {
          await dingtalkStreamGatewayStart();
          void message.success("钉钉远程入口已启动");
        } else {
          await dingtalkStreamGatewayStop();
          void message.success("钉钉远程入口已停止");
        }
        await refreshDingtalk();
      } catch (err) {
        await refreshDingtalk();
        void message.error(err instanceof Error ? err.message : "钉钉远程入口切换失败");
      } finally {
        setStreamBusy(false);
      }
    },
    [dingTalkConfigured, refreshDingtalk],
  );

  const cardMeta = useCallback(
    (channel: ChannelDefinition): { label: string; configured: boolean; running?: boolean } => {
      switch (channel.key) {
        case "dingtalk":
          return {
            configured: dingTalkConfigured,
            running: streamRunning,
            label: dingtalkRowMeta({ configured: dingTalkConfigured, status: streamStatus }),
          };
        case "feishu":
          return {
            configured: feishuConfigured,
            label: feishuConfigured ? "Webhook 已配置" : "未配置",
          };
        case "wecom":
          return {
            configured: wecomConfigured,
            label: wecomConfigured ? "Webhook 已配置" : "未配置",
          };
        case "telegram":
          return {
            configured: telegramConfigured,
            label: telegramConfigured ? "Bot 已配置" : "未配置",
          };
        case "websocket":
          return {
            configured: wsConfigured,
            running: wsStatus.running,
            label: wsConfigured ? `${wsConfigured ? "已配置" : "未配置"} · ${phaseLabel(wsStatus.phase)}` : "未配置",
          };
      }
    },
    [
      dingTalkConfigured,
      feishuConfigured,
      streamRunning,
      streamStatus,
      telegramConfigured,
      wecomConfigured,
      wsConfigured,
      wsStatus.phase,
      wsStatus.running,
    ],
  );

  return (
    <AuthorPanelPageShell
      className="app-channels-panel"
      icon={<GatewayOutlined />}
      title="远程入口"
      subtitle="移动端通知、回执与远程控制"
    >
      <AuthorPanelListShell className="app-channels-panel__list-shell">
        <div className="app-channels-hub__grid" aria-label="渠道网关">
          {CHANNELS.map((channel) => {
            const meta = cardMeta(channel);
            const isActive = activeKey === channel.key;
            const showSwitch = channel.key === "dingtalk" || channel.key === "websocket";
            return (
              <button
                key={channel.key}
                type="button"
                className={`app-channels-hub__card${isActive ? " app-channels-hub__card--active" : ""}${!meta.configured ? " app-channels-hub__card--unconfigured" : ""}`}
                onClick={() => setActiveKey(channel.key)}
              >
                <div className="app-channels-hub__card-header">
                  <span className={`app-channels-hub__card-icon app-channels-hub__card-icon--${channel.key}`}>
                    {channel.icon}
                  </span>
                  {showSwitch ? (
                    <Switch
                      size="small"
                      checked={Boolean(meta.running)}
                      loading={channel.key === "dingtalk" ? streamBusy : false}
                      disabled={!meta.configured || (channel.key === "websocket")}
                      onChange={(next, event) => {
                        event.stopPropagation();
                        if (channel.key === "dingtalk") void handleToggleDingTalk(next);
                      }}
                      onClick={(_checked, event) => event.stopPropagation()}
                    />
                  ) : (
                    <span
                      className={`app-channels-hub__card-badge${meta.configured ? " app-channels-hub__card-badge--ok" : ""}`}
                    >
                      {meta.configured ? "可用" : "待配置"}
                    </span>
                  )}
                </div>
                <div className="app-channels-hub__card-body">
                  <div className="app-channels-hub__card-title" title={channel.title}>{channel.title}</div>
                  <div className="app-channels-hub__card-meta" title={meta.label}>{meta.label}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="app-channels-hub__detail">
          {activeKey === "dingtalk" ? (
            <DingtalkChannelBody
              dingTalkConfigured={dingTalkConfigured}
              streamStatus={streamStatus}
              streamBusy={streamBusy}
              onRefreshStatus={refreshDingtalk}
              onToggleDingTalk={handleToggleDingTalk}
            />
          ) : activeKey === "feishu" ? (
            <FeishuChannelBody onConfiguredChange={setFeishuConfigured} />
          ) : activeKey === "wecom" ? (
            <WecomChannelBody onConfiguredChange={setWecomConfigured} />
          ) : activeKey === "telegram" ? (
            <TelegramChannelBody onConfiguredChange={setTelegramConfigured} />
          ) : activeKey === "websocket" ? (
            <GenericWebSocketChannelBody
              onConfiguredChange={setWsConfigured}
              onStatusChange={setWsStatus}
            />
          ) : (
            <Empty
              className="app-channels-panel__placeholder"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="该渠道暂未实现"
            />
          )}
        </div>
      </AuthorPanelListShell>
    </AuthorPanelPageShell>
  );
}

interface DingtalkChannelBodyProps {
  dingTalkConfigured: boolean;
  streamStatus: DingTalkStreamGatewayStatus | null;
  streamBusy: boolean;
  onRefreshStatus: () => void | Promise<void>;
  onToggleDingTalk: (next: boolean) => void | Promise<void>;
}

function formatStatusTime(value?: string | null): string {
  if (!value) return "无";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ts);
}

function phaseLabel(phase?: string | null): string {
  if (phase === "connected") return "已连接";
  if (phase === "connecting") return "连接中";
  if (phase === "reconnecting") return "重连中";
  return "未运行";
}

function dingtalkRowMeta({
  configured,
  status,
}: {
  configured: boolean;
  status: DingTalkStreamGatewayStatus | null;
}): string {
  const configLabel = configured ? "已配置" : "未配置";
  const phase = status?.lastError ? "网关异常" : phaseLabel(status?.phase);
  return `${configLabel} · ${phase}`;
}

function DingtalkChannelBody({
  dingTalkConfigured,
  streamStatus,
  streamBusy,
  onRefreshStatus,
  onToggleDingTalk,
}: DingtalkChannelBodyProps) {
  const status: DingTalkStreamGatewayStatus = streamStatus ?? { running: false, phase: "stopped" };
  return (
    <div className="app-channels-panel__body">
      <div className="app-channels-panel__ops">
        <div className="app-channels-panel__ops-head">
          <div>
            <Typography.Text strong>钉钉 Stream 网关</Typography.Text>
            <div className="app-channels-panel__ops-subtitle">入站、执行、回执</div>
          </div>
          <Tag color={status.running ? "success" : status.lastError ? "error" : "default"}>
            {phaseLabel(status.phase)}
          </Tag>
        </div>
        <div className="app-channels-panel__metrics">
          <span>连接：{formatStatusTime(status.connectedAt)}</span>
          <span>入站：{formatStatusTime(status.lastInboundAt)}</span>
          <span>错误：{formatStatusTime(status.lastErrorAt)}</span>
        </div>
        {status.lastError ? (
          <Typography.Text type="danger" className="app-channels-panel__error">
            {status.lastError}
          </Typography.Text>
        ) : null}
        <Space wrap className="app-channels-panel__ops-actions">
          <Button
            type="primary"
            size="small"
            loading={streamBusy}
            disabled={!dingTalkConfigured || status.running}
            onClick={() => void onToggleDingTalk(true)}
          >
            启动
          </Button>
          <Button
            size="small"
            loading={streamBusy}
            disabled={!status.running}
            onClick={() => void onToggleDingTalk(false)}
          >
            停止
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void onRefreshStatus()}>
            刷新
          </Button>
        </Space>
        {dingTalkConfigured ? null : (
          <Typography.Text type="warning" className="app-channels-panel__hint">
            先保存 AppKey / AppSecret / robotCode 后再启动。
          </Typography.Text>
        )}
      </div>
      <Tabs
        size="small"
        className="app-channels-panel__dingtalk-tabs"
        items={[
          {
            key: "config",
            label: "配置",
            children: <DingTalkEnterpriseBotPopoverBody compact />,
          },
          {
            key: "debug",
            label: "联调",
            children: <DingTalkEnterpriseBotPopoverBody compact initialSection="debug" />,
          },
          {
            key: "push",
            label: "中继",
            children: <DingTalkEnterpriseBotPopoverBody compact initialSection="push" />,
          },
        ]}
      />
    </div>
  );
}
