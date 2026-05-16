import { useEffect, useState } from "react";
import { Empty, Spin, Tag, Typography } from "antd";
import {
  ThunderboltOutlined,
  CodeOutlined,
  PlayCircleOutlined,
  BranchesOutlined,
  FileTextOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  listTrellisRuntimeEvents,
  type TrellisRuntimeEvent,
} from "../../../services/trellisRuntime";

interface RuntimeEventFeedProps {
  rootPath?: string | null;
  projectId?: string | null;
  limit?: number;
}

const KIND_ICON: Record<string, React.ReactNode> = {
  hook: <ThunderboltOutlined />,
  task: <PlayCircleOutlined />,
  agent: <BranchesOutlined />,
  spec: <FileTextOutlined />,
  workflow: <SettingOutlined />,
  _default: <CodeOutlined />,
};

function kindIcon(kind: string) {
  for (const [key, icon] of Object.entries(KIND_ICON)) {
    if (kind.includes(key)) return icon;
  }
  return KIND_ICON._default;
}

function kindLabel(kind: string): string {
  if (kind.includes("hook")) return "Hook";
  if (kind.includes("task.create")) return "创建任务";
  if (kind.includes("task.start")) return "开始任务";
  if (kind.includes("task.complete")) return "完成任务";
  if (kind.includes("agent.start")) return "Agent 启动";
  if (kind.includes("agent.complete")) return "Agent 完成";
  if (kind.includes("spec")) return "Spec 变更";
  if (kind.includes("workflow")) return "Workflow";
  return kind.replace("trellis.", "").replace("runtime.", "");
}

export function RuntimeEventFeed({ rootPath, projectId, limit = 30 }: RuntimeEventFeedProps) {
  const [events, setEvents] = useState<TrellisRuntimeEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rootPath) { setEvents([]); return; }
    let cancelled = false;
    setLoading(true);
    const fetch = () => {
      if (cancelled) return;
      listTrellisRuntimeEvents({ projectId, rootPath, limit })
        .then((list) => { if (!cancelled) setEvents(list); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    fetch();
    const timer = setInterval(fetch, 6_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rootPath, limit]);

  if (!rootPath) return null;

  return (
    <section className="runtime-feed">
      <div className="runtime-feed__header">
        <ThunderboltOutlined />
        <Typography.Text strong style={{ fontSize: 12 }}>Runtime 事件</Typography.Text>
        <Tag style={{ fontSize: 10 }}>{events.length}</Tag>
      </div>
      <div className="runtime-feed__scroll">
        {loading && events.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center" }}><Spin size="small" /></div>
        ) : events.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行时事件" />
        ) : (
          <div className="runtime-feed__list">
            {events.map((ev) => (
              <div key={ev.eventId} className="runtime-event">
                <span className="runtime-event__icon">{kindIcon(ev.eventKind)}</span>
                <div className="runtime-event__body">
                  <div className="runtime-event__head">
                    <span className="runtime-event__kind">{kindLabel(ev.eventKind)}</span>
                    <span className="runtime-event__time">
                      {new Date(ev.createdAt).toLocaleTimeString("zh-CN")}
                    </span>
                  </div>
                  {ev.taskPath ? (
                    <span className="runtime-event__task">{ev.taskPath.split("/").pop()}</span>
                  ) : null}
                  {ev.actor ? (
                    <Tag style={{ fontSize: 9, lineHeight: "14px", margin: "2px 0 0" }}>
                      {ev.actor}
                    </Tag>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
