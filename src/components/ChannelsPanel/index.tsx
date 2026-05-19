import {
  ApiOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  DingdingOutlined,
  MessageOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { Collapse, Empty, Switch, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DingTalkEnterpriseBotPopoverBody } from "../DingTalkEnterpriseBotPopoverBody";
import { loadDingTalkEnterpriseBotConfig } from "../../services/dingtalkEnterpriseBot";
import {
  dingtalkStreamGatewayIsRunning,
  dingtalkStreamGatewayStart,
  dingtalkStreamGatewayStop,
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
    comingSoonHint: "复用同一套通道消息、权限批准和回执模型，敬请期待。",
  },
  {
    key: "wecom",
    title: "企业微信",
    icon: <SendOutlined />,
    available: false,
    comingSoonHint: "面向企业审批和远程批准，敬请期待。",
  },
  {
    key: "telegram",
    title: "Telegram",
    icon: <ApiOutlined />,
    available: false,
    comingSoonHint: "面向个人移动端远程控制和任务追踪，敬请期待。",
  },
  {
    key: "websocket",
    title: "通用 WebSocket",
    icon: <CloudServerOutlined />,
    available: false,
    comingSoonHint: "平台无关入站协议，作为后续扩展平台的统一中继，敬请期待。",
  },
];

export function ChannelsPanel() {
  const [activeKey, setActiveKey] = useState<ChannelKey | undefined>("dingtalk");
  const [dingTalkConfigured, setDingTalkConfigured] = useState(false);
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamBusy, setStreamBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    const [config, running] = await Promise.all([
      loadDingTalkEnterpriseBotConfig().catch(() => null),
      dingtalkStreamGatewayIsRunning().catch(() => false),
    ]);
    setDingTalkConfigured(
      Boolean(config?.appKey?.trim() && config.appSecret?.trim() && config.robotCode?.trim()),
    );
    setStreamRunning(running);
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
        } else {
          await dingtalkStreamGatewayStop();
        }
        await refreshStatus();
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
        return {
          key: channel.key,
          label: (
            <div className="app-channels-panel__row">
              <span className="app-channels-panel__row-icon" aria-hidden>
                {channel.icon}
              </span>
              <span className="app-channels-panel__row-title">{channel.title}</span>
              {!channel.available ? (
                <span className="app-channels-panel__row-tag">待接入</span>
              ) : null}
            </div>
          ),
          extra: (
            <Switch
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
            <ChannelBody channel={channel} dingTalkConfigured={dingTalkConfigured} />
          ),
        };
      }),
    [dingTalkConfigured, handleToggleDingTalk, streamBusy, streamRunning],
  );

  return (
    <section className="app-channels-panel" aria-label="远程入口">
      <header className="app-channels-panel__header">
        <Typography.Title level={4} className="app-channels-panel__title">
          渠道配置
        </Typography.Title>
        <Typography.Paragraph className="app-channels-panel__subtitle">
          连接钉钉、飞书、企业微信、Telegram，在即时通讯软件中与 Wise 交互。
        </Typography.Paragraph>
        <ol className="app-channels-panel__steps">
          <li>
            <span className="app-channels-panel__step-index">1</span>
            <CheckCircleOutlined />
            <span>选择一个渠道并完成凭据配置。</span>
          </li>
          <li>
            <span className="app-channels-panel__step-index">2</span>
            <CheckCircleOutlined />
            <span>启用该渠道后，即可开始与 Wise 交互。</span>
          </li>
        </ol>
      </header>

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
    </section>
  );
}

interface ChannelBodyProps {
  channel: ChannelDefinition;
  dingTalkConfigured: boolean;
}

function ChannelBody({ channel, dingTalkConfigured }: ChannelBodyProps) {
  if (channel.key === "dingtalk") {
    return (
      <div className="app-channels-panel__body">
        {dingTalkConfigured ? null : (
          <Typography.Text type="warning" className="app-channels-panel__hint">
            请先填写企业机器人凭据并保存，才能启用钉钉渠道。
          </Typography.Text>
        )}
        <DingTalkEnterpriseBotPopoverBody />
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
