import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Checkbox, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { CollabInboxEntry } from "../../../types/collaboration";
import {
  COLLAB_EXTERNAL_CHANNEL_LABELS,
  COLLAB_NOTIFY_TYPES,
  formatCollabError,
  hydrateCollabChannelSettings,
  listCollabInbox,
  markCollabInboxRead,
  messageSummary,
  messageTypeLabel,
  onCollabChanged,
  requeueCollabMessage,
  updateCollabChannelSettings,
  useCollabChannelSettings,
  type CollabExternalChannel,
} from "../../../services/collaboration";
import { openCollabRequirementDetail } from "../../../stores/collabUiStore";
import { formatTime } from "../requirement/detailContext";
import "../collaboration.css";

const PAGE = 50;

function channelDeliveryTag(entry: CollabInboxEntry) {
  if (entry.outboxState === "dead") {
    return (
      <Tooltip title={entry.outboxError ?? undefined}>
        <Tag color="error">已放弃</Tag>
      </Tooltip>
    );
  }
  const d = entry.message.deliveries.find((x) => x.targetKind === "channel");
  const state = d?.state ?? "queued";
  if (state === "failed") {
    return (
      <Tooltip title={d?.lastError ?? entry.outboxError ?? undefined}>
        <Tag color="warning">失败·重试中（{entry.outboxAttempts}）</Tag>
      </Tooltip>
    );
  }
  if (state === "queued") return <Tag color="processing">待投递</Tag>;
  return <Tag color="success">已送达</Tag>;
}

/** 协作收件箱：所有需要用户处理的协作通知，含渠道投递状态、已读处理与失败重投。 */
export function CollabInboxChannelBody() {
  const { message } = AntApp.useApp();
  const settings = useCollabChannelSettings();
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [entries, setEntries] = useState<CollabInboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listCollabInbox({ limit: PAGE, unreadOnly: filter === "unread" });
      setEntries(list);
      setHasMore(list.length >= PAGE);
    } catch (e) {
      message.error(formatCollabError(e));
    } finally {
      setLoading(false);
    }
  }, [filter, message]);

  useEffect(() => {
    void hydrateCollabChannelSettings();
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let timer: number | null = null;
    void reload();
    void onCollabChanged(() => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 500);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [reload]);

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    try {
      const more = await listCollabInbox({ before: last.message.createdAt, limit: PAGE, unreadOnly: filter === "unread" });
      setEntries((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.message.id === m.message.id))]);
      setHasMore(more.length >= PAGE);
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await markCollabInboxRead(ids);
      void reload();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const requeue = async (entry: CollabInboxEntry) => {
    try {
      await requeueCollabMessage(entry.message.id);
      message.success("已重新排队投递");
      void reload();
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const save = async (patch: Parameters<typeof updateCollabChannelSettings>[0]) => {
    try {
      await updateCollabChannelSettings(patch);
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const unreadIds = entries.filter((e) => !e.read).map((e) => e.message.id);

  return (
    <div className="app-channels-panel__body collab-inbox">
      <div className="app-channels-panel__ops">
        <div className="app-channels-panel__ops-head">
          <div>
            <Typography.Text strong>协作收件箱</Typography.Text>
            <div className="app-channels-panel__ops-subtitle">决策、验收、失败、修正与停止待确认的统一入口</div>
          </div>
          <Tag color={unreadIds.length ? "processing" : "default"}>{unreadIds.length} 条未读</Tag>
        </div>
        <Space wrap size={16} className="collab-inbox__settings">
          <label className="collab-automation__field">
            <Switch size="small" checked={settings.desktopToast} onChange={(v) => void save({ desktopToast: v })} />
            <span>桌面提醒</span>
          </label>
          <label className="collab-automation__field">
            <span>转发到</span>
            <Select<CollabExternalChannel>
              size="small"
              style={{ width: 120 }}
              value={settings.external}
              options={(Object.keys(COLLAB_EXTERNAL_CHANNEL_LABELS) as CollabExternalChannel[]).map((k) => ({
                value: k,
                label: COLLAB_EXTERNAL_CHANNEL_LABELS[k],
              }))}
              onChange={(v) => void save({ external: v })}
            />
          </label>
        </Space>
        <Checkbox.Group
          className="collab-inbox__types"
          value={settings.types}
          options={COLLAB_NOTIFY_TYPES.map((t) => ({ value: t, label: messageTypeLabel(t) }))}
          onChange={(v) => void save({ types: v as string[] })}
        />
        <Typography.Text type="secondary" className="app-channels-panel__hint">
          未勾选的类型只进入收件箱，不弹提醒也不转发；外部渠道使用本页对应卡片中的配置，失败会自动退避重试。
        </Typography.Text>
      </div>

      <div className="collab-inbox__toolbar">
        <Segmented
          size="small"
          value={filter}
          options={[
            { value: "unread", label: "未读" },
            { value: "all", label: "全部" },
          ]}
          onChange={(v) => setFilter(v as "unread" | "all")}
        />
        <Space size={8}>
          <Button size="small" disabled={!unreadIds.length} onClick={() => void markRead(unreadIds)}>
            全部标为已读
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
            刷新
          </Button>
        </Space>
      </div>

      <Table<CollabInboxEntry>
        size="small"
        rowKey={(e) => e.message.id}
        pagination={false}
        loading={loading}
        dataSource={entries}
        locale={{ emptyText: filter === "unread" ? "没有未读的协作通知" : "暂无协作通知" }}
        rowClassName={(e) => (e.read ? "collab-inbox__row--read" : "")}
        columns={[
          { title: "时间", width: 160, render: (_, e) => formatTime(e.message.createdAt) },
          { title: "类型", width: 100, render: (_, e) => <Tag>{messageTypeLabel(e.message.type)}</Tag> },
          {
            title: "需求 / 摘要",
            render: (_, e) => (
              <div className="collab-inbox__summary">
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    openCollabRequirementDetail(e.requirementId, e.message.type === "requirement.verifying" ? "acceptance" : "overview");
                    if (!e.read) void markRead([e.message.id]);
                  }}
                >
                  {e.requirementTitle || e.requirementId}
                </Button>
                <span>{messageSummary(e.message)}</span>
              </div>
            ),
          },
          { title: "外部投递", width: 130, render: (_, e) => channelDeliveryTag(e) },
          {
            title: "",
            width: 150,
            render: (_, e) => {
              const d = e.message.deliveries.find((x) => x.targetKind === "channel");
              const retry = e.outboxState === "dead" || d?.state === "failed";
              return (
                <Space size={0}>
                  {retry ? (
                    <Button size="small" type="link" onClick={() => void requeue(e)}>
                      重新投递
                    </Button>
                  ) : null}
                  {!e.read ? (
                    <Button size="small" type="link" onClick={() => void markRead([e.message.id])}>
                      已处理
                    </Button>
                  ) : (
                    <Typography.Text type="secondary">已处理</Typography.Text>
                  )}
                </Space>
              );
            },
          },
        ]}
      />
      {hasMore ? (
        <Button size="small" type="link" onClick={() => void loadMore()}>
          加载更早的通知
        </Button>
      ) : null}
    </div>
  );
}
