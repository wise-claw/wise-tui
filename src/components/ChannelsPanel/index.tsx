import {
  ApiOutlined,
  CloudServerOutlined,
  DingdingOutlined,
  GatewayOutlined,
  MessageOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Button, Collapse, Empty, Space, Switch, Tabs, Tag, Typography, message } from "antd";
import { AuthorPanelListShell, AuthorPanelPageShell } from "../AuthorPanel/AuthorPanelPageShell";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DingTalkEnterpriseBotPopoverBody } from "../DingTalkEnterpriseBotPopoverBody";
import { loadDingTalkEnterpriseBotConfig } from "../../services/dingtalkEnterpriseBot";
import {
  dingtalkStreamGatewayIsRunning,
  dingtalkStreamGatewayStart,
  dingtalkStreamGatewayStatus,
  dingtalkStreamGatewayStop,
  type DingTalkStreamGatewayStatus,
} from "../../services/dingtalkStreamGateway";
import "./index.css";

type ChannelKey = "dingtalk" | "feishu" | "wecom" | "telegram" | "websocket";

interface ChannelDefinition {
  key: ChannelKey;
  title: string;
  icon: ReactNode;
  available: boolean;
  comingSoonHint?: string;
}

const CHANNELS: ChannelDefinition[] = [
  { key: "dingtalk", title: "钉钉", icon: <DingdingOutlined />, available: true },
  {
    key: "feishu",
    title: "飞书",
    icon: <MessageOutlined />,
    available: false,
    comingSoonHint: "暂未接入",
  },
  {
    key: "wecom",
    title: "企业微信",
    icon: <SendOutlined />,
    available: false,
    comingSoonHint: "暂未接入",
  },
  {
    key: "telegram",
    title: "Telegram",
    icon: <ApiOutlined />,
    available: false,
    comingSoonHint: "暂未接入",
  },
  {
    key: "websocket",
    title: "通用 WebSocket",
    icon: <CloudServerOutlined />,
    available: false,
    comingSoonHint: "暂未接入",
  },
];

export function ChannelsPanel() {
  const [activeKey, setActiveKey] = useState<ChannelKey | undefined>("dingtalk");
  const [dingTalkConfigured, setDingTalkConfigured] = useState(false);
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamStatus, setStreamStatus] = useState<DingTalkStreamGatewayStatus | null>(null);
  const [streamBusy, setStreamBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
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
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 3000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

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
        await refreshStatus();
      } catch (err) {
        await refreshStatus();
        void message.error(err instanceof Error ? err.message : "钉钉远程入口切换失败");
      } finally {
        setStreamBusy(false);
      }
    },
    [dingTalkConfigured, refreshStatus],
  );

  const items = useMemo(
    () =>
      CHANNELS.map((channel) => {
        const enabled = channel.key === "dingtalk" ? streamRunning : false;
        const canToggle = channel.available && (channel.key !== "dingtalk" || dingTalkConfigured);
        const metaLabel =
          channel.key === "dingtalk"
            ? dingtalkRowMeta({
                configured: dingTalkConfigured,
                status: streamStatus,
              })
            : channel.comingSoonHint ?? "暂未接入";
        return {
          key: channel.key,
          label: (
            <div className="app-channels-panel__row">
              <span className="app-channels-panel__row-icon" aria-hidden>
                {channel.icon}
              </span>
              <span className="app-channels-panel__row-copy">
                <span className="app-channels-panel__row-title">{channel.title}</span>
                <span className="app-channels-panel__row-meta">{metaLabel}</span>
              </span>
              {!channel.available ? (
                <span className="app-channels-panel__row-tag">待接入</span>
              ) : null}
            </div>
          ),
          extra: (
            <Switch
              size="small"
              checked={enabled}
              loading={channel.key === "dingtalk" ? streamBusy : false}
              disabled={!canToggle}
              onChange={(next, event) => {
                event.stopPropagation();
                if (channel.key === "dingtalk") void handleToggleDingTalk(next);
              }}
              onClick={(_checked, event) => event.stopPropagation()}
            />
          ),
          children: (
            <ChannelBody
              channel={channel}
              dingTalkConfigured={dingTalkConfigured}
              streamStatus={channel.key === "dingtalk" ? streamStatus : null}
              streamBusy={streamBusy}
              onRefreshStatus={refreshStatus}
              onToggleDingTalk={handleToggleDingTalk}
            />
          ),
        };
      }),
    [dingTalkConfigured, handleToggleDingTalk, refreshStatus, streamBusy, streamRunning, streamStatus],
  );

  return (
    <AuthorPanelPageShell
      className="app-channels-panel"
      icon={<GatewayOutlined />}
      title="远程入口"
      subtitle="移动端通知、回执与远程控制"
    >
      <AuthorPanelListShell className="app-channels-panel__list-shell">
        <Collapse
          accordion
          bordered={false}
          ghost
          activeKey={activeKey}
          onChange={(key) => {
            const next = Array.isArray(key) ? key[0] : key;
            setActiveKey((next as ChannelKey | undefined) ?? undefined);
          }}
          items={items}
          className="app-channels-panel__list"
        />
      </AuthorPanelListShell>
    </AuthorPanelPageShell>
  );
}

interface ChannelBodyProps {
  channel: ChannelDefinition;
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

function ChannelBody({
  channel,
  dingTalkConfigured,
  streamStatus,
  streamBusy,
  onRefreshStatus,
  onToggleDingTalk,
}: ChannelBodyProps) {
  if (channel.key === "dingtalk") {
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
  return (
    <Empty
      className="app-channels-panel__placeholder"
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={channel.comingSoonHint ?? `${channel.title} 即将接入。`}
    />
  );
}
