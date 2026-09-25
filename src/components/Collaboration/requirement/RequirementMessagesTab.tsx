import { useEffect, useState } from "react";
import { App as AntApp, Button, Empty, List, Select, Space, Tag, Typography } from "antd";
import {
  formatCollabError,
  listCollabMessages,
  messageSummary,
  messageTypeLabel,
  requeueCollabMessage,
} from "../../../services/collaboration";
import type { CollabMessage } from "../../../types/collaboration";
import { formatTime, taskTitle, type CollabDetailContext } from "./detailContext";

const DELIVERY_LABEL: Record<string, { label: string; color: string }> = {
  queued: { label: "待送达", color: "default" },
  failed: { label: "送达失败", color: "error" },
  delivered: { label: "已送达", color: "processing" },
  received: { label: "已接收", color: "processing" },
  processed: { label: "已处理", color: "success" },
  dropped: { label: "已丢弃", color: "default" },
};

const PAGE = 100;

/** 协作消息：持久收件箱投影，展示发送方、接收任务、关联交付与送达状态，失败可人工重投。 */
export function RequirementMessagesTab({ ctx }: { ctx: CollabDetailContext }) {
  const { message } = AntApp.useApp();
  const { snapshot } = ctx;
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<CollabMessage[]>(snapshot.messages);
  const [hasMore, setHasMore] = useState(snapshot.messages.length >= 200);

  useEffect(() => {
    if (!taskFilter) {
      setRows(snapshot.messages);
      setHasMore(snapshot.messages.length >= 200);
      return;
    }
    void listCollabMessages(snapshot.requirement.id, { taskId: taskFilter, limit: PAGE })
      .then((list) => {
        setRows(list);
        setHasMore(list.length >= PAGE);
      })
      .catch((e) => message.error(formatCollabError(e)));
  }, [message, snapshot.messages, snapshot.requirement.id, taskFilter]);

  const loadOlder = async () => {
    const oldest = rows.reduce<number | null>((min, m) => (min == null || m.createdAt < min ? m.createdAt : min), null);
    if (oldest == null) return;
    try {
      const older = await listCollabMessages(snapshot.requirement.id, { taskId: taskFilter ?? undefined, before: oldest, limit: PAGE });
      const seen = new Set(rows.map((m) => m.id));
      setRows([...rows, ...older.filter((m) => !seen.has(m.id))]);
      setHasMore(older.length >= PAGE);
    } catch (e) {
      message.error(formatCollabError(e));
    }
  };

  const sorted = [...rows].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Select
        allowClear
        style={{ width: 280 }}
        placeholder="按任务筛选"
        value={taskFilter ?? undefined}
        options={snapshot.tasks.map((t) => ({ value: t.id, label: t.title }))}
        onChange={(v?: string) => setTaskFilter(v ?? null)}
      />
      {sorted.length === 0 ? (
        <Empty description="暂无协作消息" />
      ) : (
        <List
          size="small"
          dataSource={sorted}
          renderItem={(m) => {
            const failed = m.deliveries.some((d) => d.state === "failed");
            return (
              <List.Item
                actions={
                  failed
                    ? [
                        <Button
                          key="requeue"
                          size="small"
                          type="link"
                          onClick={() =>
                            void requeueCollabMessage(m.id)
                              .then(() => {
                                message.success("已重新投递");
                                ctx.reload();
                              })
                              .catch((e) => message.error(formatCollabError(e)))
                          }
                        >
                          重新投递
                        </Button>,
                      ]
                    : []
                }
              >
                <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
                  <Space size={6} wrap>
                    <Tag>{messageTypeLabel(m.type)}</Tag>
                    <Typography.Text type="secondary">
                      {m.sourceTaskId ? taskTitle(snapshot.tasks, m.sourceTaskId) : "Wise"} → {m.targetTaskId ? taskTitle(snapshot.tasks, m.targetTaskId) : "需求"}
                    </Typography.Text>
                    {m.round != null ? <Typography.Text type="secondary">第 {m.round} 轮</Typography.Text> : null}
                    <Typography.Text type="secondary">{formatTime(m.createdAt)}</Typography.Text>
                  </Space>
                  <Typography.Text>{messageSummary(m)}</Typography.Text>
                  {m.deliveries.length ? (
                    <Space size={4} wrap>
                      {m.deliveries.map((d, i) => {
                        const meta = DELIVERY_LABEL[d.state] ?? { label: d.state, color: "default" };
                        return (
                          <Tag key={i} color={meta.color} title={d.lastError ?? undefined}>
                            {d.targetKind === "task" ? taskTitle(snapshot.tasks, d.targetId) : d.targetId} · {meta.label}
                            {d.attempts > 1 ? ` ×${d.attempts}` : ""}
                          </Tag>
                        );
                      })}
                    </Space>
                  ) : null}
                </Space>
              </List.Item>
            );
          }}
        />
      )}
      {hasMore ? (
        <Button size="small" onClick={() => void loadOlder()}>
          加载更早的消息
        </Button>
      ) : null}
    </Space>
  );
}
